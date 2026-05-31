import "dotenv/config";

import { createApp } from "./app/create-app.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig();
const app = createApp(config);

await app.start();
