import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import { assertAppEnvironment } from "./lib/environment-isolation";

const isolation = assertAppEnvironment();

const config = {
  ...defineCloudflareConfig(),
  buildCommand: isolation.mode === "staging" ? "npm run build:staging" : "npm run build:production",
};

export default config;
