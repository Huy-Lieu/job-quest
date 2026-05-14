// Run with: node list-company-careers.mjs
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY from .env.local automatically

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Parse .env.local
const env = Object.fromEntries(
  readFileSync(new URL('.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const key = env['SUPABASE_SERVICE_KEY'];
const sb = createClient(url, key);

const JOB_BOARDS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter',
  'monster.com', 'simplyhired', 'careerbuilder', 'google.com/search',
  'jobs.google.com', 'serpapi', 'apify.com',
];

const isJobBoard = (u) =>
  !u || JOB_BOARDS.some(b => u.toLowerCase().includes(b));

// Fetch jobs with their url column
const { data: jobs, error } = await sb
  .from('jobs')
  .select('company, url, source')
  .order('company')
  .limit(1000);

if (error) { console.error('Supabase error:', error.message); process.exit(1); }

// Also fetch job_sources to get source_url (direct ATS links)
const { data: sources, error: srcErr } = await sb
  .from('job_sources')
  .select('job_id, source_url, source_name')
  .limit(2000);

if (srcErr) { console.error('job_sources error:', srcErr.message); process.exit(1); }

// Build a map of job_id -> best (non-board) source_url
const sourceMap = {};
for (const s of sources) {
  const u = s.source_url || '';
  const isBoard = isJobBoard(u);
  if (!sourceMap[s.job_id] || (!isBoard && isJobBoard(sourceMap[s.job_id]))) {
    sourceMap[s.job_id] = u;
  }
}

// Also need job id — re-fetch with id
const { data: jobsFull, error: e2 } = await sb
  .from('jobs')
  .select('id, company, url, source')
  .order('company')
  .limit(1000);

if (e2) { console.error('Supabase error:', e2.message); process.exit(1); }

// Deduplicate: one row per company, prefer direct career-site URLs
const companyMap = {};
for (const j of jobsFull) {
  const company = (j.company || '').trim();
  if (!company) continue;

  // Best URL: job.url first, then job_sources.source_url
  const directUrl = (j.url || '').trim();
  const sourceUrl = (sourceMap[j.id] || '').trim();
  const bestUrl = (!isJobBoard(directUrl) ? directUrl : !isJobBoard(sourceUrl) ? sourceUrl : directUrl || sourceUrl) || '';
  const isBoard = isJobBoard(bestUrl);

  if (!companyMap[company]) {
    companyMap[company] = { url: bestUrl, isBoard };
  } else if (!isBoard && companyMap[company].isBoard) {
    companyMap[company] = { url: bestUrl, isBoard };
  }
}

const careerSite = [];
const boardOnly = [];

for (const [company, info] of Object.entries(companyMap).sort(([a], [b]) => a.localeCompare(b))) {
  if (!info.isBoard) {
    careerSite.push({ company, url: info.url });
  } else {
    boardOnly.push({ company, url: info.url });
  }
}

console.log('\n========================================');
console.log(' COMPANIES WITH DIRECT CAREER-SITE URLs');
console.log('========================================\n');
for (const { company, url } of careerSite) {
  console.log(`${company.padEnd(42)} ${url}`);
}

console.log('\n========================================');
console.log(' COMPANIES — JOB BOARD LINKS ONLY');
console.log('========================================\n');
for (const { company, url } of boardOnly) {
  console.log(`${company.padEnd(42)} ${url || '(no URL)'}`);
}

console.log(`\nTotal companies: ${Object.keys(companyMap).length}`);
console.log(`  With direct career site: ${careerSite.length}`);
console.log(`  Job board / unknown: ${boardOnly.length}`);
