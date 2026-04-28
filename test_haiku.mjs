import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const JD = `About the role
NVIDIA has continuously reinvented itself over two decades. Our invention of the GPU in 1999 sparked the growth of the PC gaming market, redefined modern computer graphics, and revolutionized parallel computing. More recently, GPU deep learning ignited modern AI — the next era of computing. NVIDIA is a "learning machine" that constantly evolves by adapting to new opportunities that are hard to resolve, that only we can seek, and that matter to the world. This is our life's work, to amplify human inventiveness and intelligence. NVIDIA's High-Speed Interconnect (HSIC) team is seeking a versatile engineer to be part of a Silicon Hardware team. You will dive into next-gen high speed interconnects like NVLink and NVLink-C2C to make advancements in efficiency and stability. This position offers the opportunity to have real impact in a dynamic, technology-focused company impacting product lines ranging from artificial intelligence, consumer graphics, self-driving cars, and more. What you'll be doing: Contribute to design of next generation of high-speed IOs, including NVLink and NVLink-C2C. Responsible for IO power optimizations and continuing to push energy efficiency. Ensure interoperability with connected devices and system components in complex interconnect topologies Deep dive into technically challenging HSIO bugs and help drive debug efforts across various teams Work closely with other engineering teams such as system architects, mixed signal and design, DGX, software/firmware, HW/SW QA, operations and AE teams to drive design, development, debug and release of next generations products. This will require that the person be on site in Santa Clara, CA, 2 to 3 days a week. What we need to see: BS or MS degree in EE/CE or equivalent experience Effective in a collaborative environment. 8+ years working in HSIO development, bringup planning, HSIO functional and electrical validation, and/or power optimization Working experience in a few of the following areas: HSIOs like PCIE or chip-to-chip interconnects including understanding of process/temp/voltage sensitivity on BER. Identifying full chip data paths for HSIO saturation and working with applications to stress test for stability, perf, and power. System level and interconnect power management optimizations Experience with large scale Data Center topologies across hosts, switches, retimers and end points. Understanding of firmware/driver structures and their interaction with HW. Strong EE fundamentals, knowledgeable in computer architecture, high speed interfaces, timing analysis, process variations, statistical error rates and power analysis. With competitive salaries and a generous benefits package, NVIDIA is widely considered to be one of the technology world's most desirable employers. We welcome you to join our team with some of the most hard-working people in the world working together to promote rapid growth. Are you passionate about becoming a part of a best-in-class team supporting the latest in GPU and AI technology? If so, we want to hear from you. #LI-Hybrid Your base salary will be determined based on your location, experience, and the pay of employees in similar positions. The base salary range is 168,000 USD - 264,500 USD for Level 4, and 196,000 USD - 310,500 USD for Level 5. You will also be eligible for equity and benefits. Applications for this job will be accepted at least until May 1, 2026.`

const SYSTEM_PROMPT = `You are an expert technical recruiter and job description analyst with deep knowledge of how job postings are written across industries, company sizes, and regions.

Your task is to extract structured, machine-readable fields from raw job description text. Your extractions will be used downstream to match candidates to roles and power ATS scoring — accuracy matters more than completeness. When in doubt, under-extract rather than over-extract.

Core extraction principles:
- Only extract what is explicitly stated. Do not infer, assume, or hallucinate fields from context.
- Descriptions may be truncated. Extract only from what is present. Do not guess at fields that may appear later in the full text.
- When a field cannot be determined confidently, use its default/unknown value — never omit a key.
- Distinguish between what a company requires vs. what they wish for. Job postings deliberately inflate requirements — your job is to cut through that.

Skills classification rules (most important):
- skills_required: ONLY if the JD uses unambiguous language — "required", "must have", "must-have", "you must", "X+ years of X", or the skill appears under a section explicitly labelled "Requirements" or "Qualifications" with no softening hedge
- skills_preferred: everything else — "preferred", "nice to have", "a plus", "bonus", "ideally", "familiarity with", "exposure to", or listed under "Preferred", "Bonus", "Nice to Have" sections
- When a requirement section mixes hard and soft requirements in the same bullet list, use the section header as the classifier — not the individual phrasing
- Do not duplicate skills across both arrays

Output format: Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.`

const USER_PROMPT = `Extract structured data from each job description below.
Return a JSON array with exactly one object per job, preserving input order.

JOBS:
[0]
Title: Senior HSIO Engineer
Company: NVIDIA
Description:
${JD}

For each job, return this exact shape — every key must be present:
{
  "index": 0,
  "role_summary": "...",
  "skills_required": [],
  "skills_preferred": [],
  "tech_stack": [],
  "work_mode": "remote|hybrid|on-site|unknown",
  "visa_sponsorship": "yes|no|unknown",
  "experience_years_min": null,
  "experience_years_max": null,
  "education_level": "bachelor|master|phd|none|unknown",
  "security_clearance": "none|preferred|required",
  "benefits_highlights": [],
  "languages_required": [],
  "seniority_level": "intern|junior|mid|senior|staff|principal|manager|director|vp|unknown",
  "role_type": "individual_contributor|manager|hybrid|unknown",
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null
}`

const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 2048,
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: USER_PROMPT }],
})

const text = response.content[0].type === 'text' ? response.content[0].text : ''
const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)[0])
console.log(JSON.stringify(parsed[0], null, 2))
