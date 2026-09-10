import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "sink";
process.env.MAIL_SINK_DIR = "./var/test-mail";
process.env.STORAGE_LOCAL_DIR = "./var/test-storage";
process.env.APP_ORIGIN = "http://localhost:3000";
