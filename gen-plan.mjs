import { readFile, writeFile } from 'node:fs/promises';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is missing');
  process.exit(1);
}

// Load prompt
const prompt = await readFile('.prompt.txt', 'utf8');

// Strict JSON edit plan:
// {
//   "changes": [
//     { "path": "README.md", "op": "append", "text": "..." },
//     { "path": "frontend/index.html", "op": "replace", "content": "<!doctype html>..." }
//   ],
//   "title": "PR title",
//   "body": "PR body"
// }
const body = {
  model: "gpt-4o-mini",
  temperature: 0.1,
  max_tokens: 6000,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content:
      "You are a repository editor. Return ONLY valid JSON with an edit plan in the shape: " +
      "{\"changes\":[{\"path\":\"<rel path>\",\"op\":\"append|replace\",\"text\":\"...\"|\"content\":\"...\"}],\"title\":\"...\",\"body\":\"...\"}. " +
      "No markdown, no prose. All file paths must be relative to repo root. For 'append', include trailing newline if needed." },
    { role: "user", content: prompt }
  ]
};

const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});

if (!resp.ok) {
  const text = await resp.text();
  console.error('OpenAI API error:', resp.status, text);
  process.exit(1);
}

const data = await resp.json();
const plan = data?.choices?.[0]?.message?.content ?? '';

// Basic validation: must be JSON with "changes"
let parsed;
try {
  parsed = JSON.parse(plan);
} catch (e) {
  console.error('Plan is not valid JSON:', plan.slice(0, 500));
  process.exit(1);
}
if (!parsed || !Array.isArray(parsed.changes)) {
  console.error('JSON plan missing "changes" array.');
  process.exit(1);
}

await writeFile('edit-plan.json', JSON.stringify(parsed, null, 2), 'utf8');
console.log('Plan OK. Changes:', parsed.changes.length);
