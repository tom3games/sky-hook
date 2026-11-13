import './../mute-auto.mjs'
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [inp, out] = process.argv.slice(2)
const svg = readFileSync(inp, 'utf8'); const m = svg.match(/width="(\d+\.?\d*)" height="(\d+\.?\d*)"/)
const b = await chromium.launch({ args: ['--mute-audio'] }); const p = await b.newPage({ viewport: { width: Math.ceil(+m[1]), height: Math.ceil(+m[2]) } })
await p.setContent('<body style="margin:0">' + svg + '</body>'); await p.screenshot({ path: out }); await b.close()
