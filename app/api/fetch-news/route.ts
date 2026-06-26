import { createClient } from '@supabase/supabase-js'
import Groq from 'groq-sdk'
import Parser from 'rss-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const parser = new Parser()

const RSS_FEEDS = [
  // World
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'http://www.aljazeera.com/xml/rss/all.xml',
  // Technology
  'https://www.theverge.com/rss/index.xml',
  'https://techcrunch.com/feed/',
  // Business
  'https://www.cnbc.com/id/10001147/device/rss/rss.html',
  // Sports
  'https://www.espn.com/espn/rss/news',
  // Politics
  'https://feeds.bbci.co.uk/news/politics/rss.xml',
  'https://rss.politico.com/politics-news.xml',
  // Health
  'https://feeds.bbci.co.uk/news/health/rss.xml',
  'https://www.who.int/rss-feeds/news-english.xml',
]

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function getUnsplashImage(query: string) {
  const res = await fetch(
    `https://api.unsplash.com/photos/random?query=${query}&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
  )
  const data = await res.json()
  return data?.urls?.regular || 'https://source.unsplash.com/random'
}

async function rewriteWithGroq(title: string, content: string) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'user',
        content: `You are a news writer. Rewrite this news article in simple, clear English.
Return a JSON object with these fields:
- title: improved headline
- content: full article (300-400 words, simple English)
- summary: 2 sentence summary
- category: one of (World, Politics, Technology, Business, Sports, Health)

Original title: ${title}
Original content: ${content}

Return only valid JSON, nothing else.`
      }
    ],
  })

  const text = completion.choices[0]?.message?.content || ''
  const clean = text
    .replace(/```json|```/g, '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim()
  return JSON.parse(clean)
}

export async function GET() {
  try {
    for (const feedUrl of RSS_FEEDS) {
      let feed
      try {
        feed = await parser.parseURL(feedUrl)
      } catch (err) {
        console.error(`Skipping feed ${feedUrl}:`, err)
        continue
      }

      const items = feed.items.slice(0, 1)

      for (const item of items) {
        const title = item.title || ''
        const content = item.contentSnippet || item.content || ''

        if (!title || !content) continue

        const { data: existing } = await supabase
          .from('articles')
          .select('id')
          .eq('title', title)
          .single()

        if (existing) continue

        const rewritten = await rewriteWithGroq(title, content)
        const image_url = await getUnsplashImage(rewritten.category)

        await supabase.from('articles').insert({
          title: rewritten.title,
          content: rewritten.content,
          summary: rewritten.summary,
          image_url,
          source_url: item.link || '',
          category: rewritten.category,
        })

        await sleep(3000)
      }
    }

    return Response.json({ success: true, message: 'Articles fetched and saved!' })
  } catch (error) {
    console.error(error)
    return Response.json({ success: false, error: String(error) }, { status: 500 })
  }
}
