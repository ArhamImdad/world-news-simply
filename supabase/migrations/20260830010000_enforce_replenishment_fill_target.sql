-- Keep provider fallback capacity separate from successful READY capacity.
-- The live eligible depth is checked under the existing queue advisory lock,
-- so concurrent enqueue attempts cannot intentionally cross the run's fill
-- target. Existing lease, duplicate, hard-maximum, and eligibility fences stay
-- in force.

CREATE OR REPLACE FUNCTION public.enqueue_ready_article_owned(
  p_article jsonb,
  p_max_queue_depth integer,
  p_permitted_source_ids text[],
  p_system_key text,
  p_replenishment_run_id uuid,
  p_fill_target integer
)
RETURNS TABLE (article_id uuid, disposition text, ready_depth integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_id uuid;
  lease_is_owned boolean := false;
  eligible_depth integer := 0;
  unexpired_ready_depth integer := 0;
BEGIN
  IF p_fill_target < 1 OR p_max_queue_depth < 1 OR p_fill_target > p_max_queue_depth THEN
    RAISE EXCEPTION 'fill target must be positive and no greater than queue maximum';
  END IF;

  -- Preserve the lease-row fence. It cannot be replaced between this check and
  -- article attribution within the current transaction.
  SELECT run_id = p_replenishment_run_id AND expires_at > clock_timestamp()
  INTO lease_is_owned
  FROM public.replenishment_run_leases
  WHERE system_key = p_system_key
  FOR UPDATE;

  IF NOT coalesce(lease_is_owned, false) THEN
    RETURN QUERY SELECT NULL::uuid, 'LEASE_NOT_OWNED'::text, 0;
    RETURN;
  END IF;

  -- Serialize the live target check with every legacy/base enqueue operation.
  PERFORM pg_advisory_xact_lock(hashtext('autonomous-ready-queue'));

  SELECT count(*)::integer
  INTO eligible_depth
  FROM public.articles candidate
  WHERE candidate.publication_status = 'draft'
    AND candidate.editorial_state = 'ready'
    AND public.ready_row_is_eligible(candidate, p_permitted_source_ids, now());

  IF eligible_depth >= p_fill_target THEN
    RETURN QUERY SELECT NULL::uuid, 'TARGET_REACHED'::text, eligible_depth;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO unexpired_ready_depth
  FROM public.articles candidate
  WHERE candidate.publication_status = 'draft'
    AND candidate.editorial_state = 'ready'
    AND candidate.expires_at > now();

  IF unexpired_ready_depth >= p_max_queue_depth THEN
    RETURN QUERY SELECT NULL::uuid, 'MAX_DEPTH_REACHED'::text, eligible_depth;
    RETURN;
  END IF;

  IF NOT public.ready_payload_is_eligible(p_article, p_permitted_source_ids, now()) THEN
    RETURN QUERY SELECT NULL::uuid, 'INELIGIBLE'::text, eligible_depth;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.articles existing
    WHERE existing.preparation_key = p_article->>'preparation_key'
       OR (
         existing.publication_status = 'approved'
         AND existing.approved_at > now() - interval '30 days'
         AND public.topic_signature_similarity(
           existing.topic_signature,
           ARRAY(SELECT jsonb_array_elements_text(p_article->'topic_signature'))
         ) >= 0.58
       )
  ) THEN
    RETURN QUERY SELECT NULL::uuid, 'DUPLICATE'::text, eligible_depth;
    RETURN;
  END IF;

  -- The base function rechecks eligibility, duplicates, and maximum depth while
  -- sharing this transaction-scoped advisory lock.
  inserted_id := public.enqueue_ready_article(
    p_article, p_max_queue_depth, p_permitted_source_ids
  );
  IF inserted_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'DUPLICATE'::text, eligible_depth;
    RETURN;
  END IF;

  INSERT INTO public.article_replenishment_attribution (article_id, run_id)
  VALUES (inserted_id, p_replenishment_run_id);

  RETURN QUERY SELECT inserted_id, 'INSERTED'::text, eligible_depth + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid, integer)
  TO service_role;

-- Prevent service-role callers from bypassing fill-target enforcement through
-- the former five-argument wrapper. The SECURITY DEFINER six-argument wrapper
-- remains able to invoke the private three-argument base function.
REVOKE ALL ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid)
  FROM service_role;

COMMENT ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid, integer) IS
  'Lease-owned atomic enqueue with distinct target, maximum, duplicate, and eligibility dispositions.';
