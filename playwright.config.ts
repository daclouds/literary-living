import {defineConfig} from '@playwright/test';
import {randomUUID} from 'node:crypto';
export default defineConfig({testDir:'./e2e',workers:1,use:{baseURL:'http://127.0.0.1:3101',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},webServer:{command:`PORT=3101 DATA_DIR=/tmp/literary-living-e2e-${randomUUID()} node server.js`,url:'http://127.0.0.1:3101/api/health',reuseExistingServer:false}});
