#!/usr/bin/env node
import { run } from "../dist/main.js";

process.exitCode = await run(process.argv.slice(2));
