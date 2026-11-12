import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RAW, SRC, STORE } from './browser.mjs';
import { COPY, SLIDES } from './copy.mjs';
import { snap } from './app.mjs';

const TEMPLATE = new URL('./template.html', import.meta.url).href;
const ICON = pathToFileURL(`${SRC}icons/128.png`).href;
const SOURCE_COLORS = ['#2f6fed', '#0f9d8a', '#0284c7', '#c026d3', '#65a30d', '#a16207', '#8b5cf6', '#f59e0b', '#10b981', '#047857', '#15803d'];

const raw = (lang, name) => pathToFileURL(`${RAW}${lang}-${name}.png`).href;
const brand = `<div class="brand"><img src="${ICON}">RentRadar <em>Austria</em></div>`;
const dots = `<div class="dots">${SOURCE_COLORS.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`;

const browserWindow = (src, width, top) => `
  <div class="window" style="--fw:${width}px; top:${top}px">
    <div class="chrome"><i></i><i></i><i></i><span class="url"><img src="${ICON}">RentRadar Austria</span></div>
    <img class="shot" src="${src}">
  </div>`;

const phone = (src, bar, ink) => `
  <div class="phone"><div class="screen" style="--sb:${bar}; --sbc:${ink}">
    <div class="statusbar"><span>9:41</span><span><i style="height:4px"></i><i style="height:6px"></i><i style="height:8px"></i><i style="height:10px"></i><b></b></span></div>
    <img src="${src}">
  </div></div>`;

function slideHtml(lang, slide) {
  const t = COPY[lang];
  const [kicker, title, sub] = t[slide.copy];
  if (slide.layout === 'split') {
    return `${brand}
      <div class="head"><span class="kicker">${kicker}</span><h1>${title}</h1>
        <ul class="feats">${t.mobileFeats.map((f) => `<li>${f}</li>`).join('')}</ul></div>
      <div class="phones">
        ${phone(raw(lang, 'mobile-list'), '#fff7f2', '#2b1e19')}
        ${phone(raw(lang, 'mobile-filters'), '#211a17', '#f6ebe5')}
      </div>`;
  }
  return `${brand}
    <div class="head"><span class="kicker">${kicker}</span><h1>${title}</h1><p class="sub">${sub}</p></div>
    ${browserWindow(raw(lang, slide.shot), 1104, 236)}`;
}

const tileHtml = (lang) => `
  <div class="tile">
    <div class="logo"><img src="${ICON}"><span>RentRadar <em>Austria</em></span></div>
    <h2>${COPY[lang].tile}</h2>
    ${dots}
  </div>`;

const marqueeHtml = (lang) => `
  <div class="tile">
    <div class="logo"><img src="${ICON}"><span>RentRadar <em>Austria</em></span></div>
    <h2>${COPY[lang].tile}</h2>
    <p>${COPY[lang].marquee}</p>
    ${dots}
  </div>
  ${browserWindow(raw(lang, 'list'), 860, 70)}`;

async function render(page, file, width, height, className, html) {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.goto(TEMPLATE);
  await page.evaluate(([w, h, cls, body]) => {
    document.documentElement.style.setProperty('--w', `${w}px`);
    document.documentElement.style.setProperty('--h', `${h}px`);
    document.body.className = cls;
    document.getElementById('root').innerHTML = body;
  }, [width, height, className, html]);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const head = document.querySelector('body:not(.split):not(.marquee) .head');
    const win = document.querySelector('body:not(.split):not(.marquee) .window');
    if (head && win) win.style.top = `${Math.round(head.getBoundingClientRect().bottom + 30)}px`;
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await page.waitForTimeout(150);
  await snap(page, file);
}

const ICONS = [
  { file: 'icon-128.png', size: 128, art: 96 },
  { file: 'icon-512.png', size: 512, art: 512 },
];

async function renderIcons(page) {
  const svg = pathToFileURL(`${SRC}app/favicon.svg`).href;
  await page.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const { file, size, art } of ICONS) {
    await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await page.setContent(`<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:transparent"><img src="${svg}" width="${art}" height="${art}"></body>`);
    await page.waitForFunction(() => document.images[0].complete);
    await snap(page, `${STORE}${file}`);
  }
  await page.cdp.send('Emulation.setDefaultBackgroundColorOverride', {});
}

export async function compose(env, langs, only) {
  const page = await env.ctx.newPage();
  page.cdp = await env.ctx.newCDPSession(page);
  if (!only || only.includes('icon')) {
    await page.goto(TEMPLATE);
    await renderIcons(page);
  }
  for (const lang of langs) {
    const dir = `${STORE}${lang}/`;
    mkdirSync(dir, { recursive: true });
    for (const slide of SLIDES) {
      if (only && !only.includes(slide.id)) continue;
      await render(page, `${dir}screenshot-${slide.id}.png`, 1280, 800, `${slide.layout ?? ''} ${slide.dark ? 'dark' : ''}`, slideHtml(lang, slide));
    }
    if (!only || only.includes('tile')) await render(page, `${dir}promo-small-440x280.png`, 440, 280, '', tileHtml(lang));
    if (!only || only.includes('marquee')) await render(page, `${dir}promo-marquee-1400x560.png`, 1400, 560, 'marquee', marqueeHtml(lang));
  }
  await page.close();
}
