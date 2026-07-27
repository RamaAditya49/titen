#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { strict as assert } from "node:assert";

const DAY_MS = 86_400_000;
const root = process.cwd();

function parseFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([a-z_]+):\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((entry) => [entry[1], entry[2]]),
  );
}

function load(kind, state) {
  const dir = join(root, "docs", kind, state);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      return { kind, state, name, text, meta: parseFrontMatter(text) };
    });
}

function validate(records, today = new Date()) {
  const errors = [];
  const byKey = new Map(
    records.map((record) => [
      `${record.kind}/${record.state}/${record.name}`,
      record,
    ]),
  );
  const get = (kind, state, name) => byKey.get(`${kind}/${state}/${name}`);
  const required = [
    "work_id",
    "status",
    "stage",
    "outcome",
    "complexity",
    "created",
    "updated",
    "owner",
  ];

  for (const record of records) {
    const label = `${record.kind}/${record.state}/${record.name}`;
    for (const field of required)
      if (!record.meta[field]) errors.push(`${label}: missing ${field}`);
    if (record.meta.status !== record.state)
      errors.push(`${label}: status must be ${record.state}`);
    if (!new Set(["simple", "complex"]).has(record.meta.complexity))
      errors.push(`${label}: invalid complexity`);

    if (record.state === "active") {
      if (!new Set(["spec", "plan", "implement"]).has(record.meta.stage))
        errors.push(`${label}: invalid active stage`);
      if (record.meta.outcome !== "pending")
        errors.push(`${label}: active outcome must be pending`);
      if (!record.meta.review_after) {
        errors.push(`${label}: missing review_after`);
      } else {
        const updated = Date.parse(`${record.meta.updated}T00:00:00Z`);
        const review = Date.parse(`${record.meta.review_after}T23:59:59Z`);
        if (!Number.isFinite(updated) || !Number.isFinite(review))
          errors.push(`${label}: invalid review date`);
        else {
          if (review < today.getTime())
            errors.push(`${label}: review_after is overdue`);
          if (review - updated > 14 * DAY_MS + DAY_MS)
            errors.push(`${label}: review_after exceeds 14 days`);
        }
      }
    } else {
      if (record.meta.stage !== "done")
        errors.push(`${label}: done stage must be done`);
      if (
        !new Set(["completed", "cancelled", "superseded"]).has(
          record.meta.outcome,
        )
      )
        errors.push(`${label}: invalid terminal outcome`);
      if (record.meta.review_after)
        errors.push(`${label}: done artifact must remove review_after`);
      if (/\b(?:TODO|TBD)\b|<[^>\n]+>|\[fill\b/i.test(record.text))
        errors.push(`${label}: unresolved placeholder`);
    }

    if (record.kind === "specs") {
      const criteria = [
        ...record.text.matchAll(
          /\*\*(AC-[A-Z0-9-]+)\s+—\s+(Ubiquitous|Event-driven|State-driven|Optional feature|Unwanted behavior):\*\*/g,
        ),
      ];
      if (!criteria.length)
        errors.push(`${label}: no identified EARS acceptance criteria`);
      if (new Set(criteria.map((match) => match[1])).size !== criteria.length)
        errors.push(`${label}: duplicate acceptance ID`);
      criteria.forEach((match, index) => {
        const segment = record.text.slice(
          match.index,
          criteria[index + 1]?.index ?? record.text.length,
        );
        const forms = {
          Ubiquitous: /\bshall\b/is,
          "Event-driven": /\bWhen\b[\s\S]*\bshall\b/is,
          "State-driven": /\bWhile\b[\s\S]*\bshall\b/is,
          "Optional feature": /\bWhere\b[\s\S]*\bshall\b/is,
          "Unwanted behavior": /\bIf\b[\s\S]*\bthen\b[\s\S]*\bshall\b/is,
        };
        if (!forms[match[2]].test(segment))
          errors.push(
            `${label}: ${match[1]} does not match ${match[2]} syntax`,
          );
      });
    } else {
      const expectedSpec = `docs/specs/${record.state}/${record.name}`;
      if (record.meta.spec !== expectedSpec)
        errors.push(`${label}: spec must be ${expectedSpec}`);
    }
  }

  for (const state of ["active", "done"]) {
    const names = new Set(
      records
        .filter((record) => record.state === state)
        .map((record) => record.name),
    );
    for (const name of names) {
      const spec = get("specs", state, name);
      const plan = get("plans", state, name);
      if (plan && !spec)
        errors.push(`plans/${state}/${name}: missing paired spec`);
      if (state === "done" && spec && !plan)
        errors.push(`specs/done/${name}: missing paired plan`);
      if (state === "active" && spec && spec.meta.stage !== "spec" && !plan)
        errors.push(
          `specs/active/${name}: ${spec.meta.stage} stage requires a plan`,
        );
      if (!spec || !plan) continue;

      for (const field of [
        "work_id",
        "status",
        "stage",
        "outcome",
        "complexity",
        "created",
        "updated",
        "review_after",
        "owner",
      ]) {
        if (spec.meta[field] !== plan.meta[field])
          errors.push(`${name}: spec/plan ${field} mismatch`);
      }
      if (
        state === "active" &&
        !new Set(["plan", "implement"]).has(plan.meta.stage)
      )
        errors.push(
          `plans/active/${name}: plan stage must be plan or implement`,
        );

      if (state === "done" && plan.meta.outcome === "completed") {
        if (/- \[ \]/.test(plan.text))
          errors.push(`plans/done/${name}: completed plan has unchecked work`);
        if (!plan.text.includes("## Acceptance evidence"))
          errors.push(`plans/done/${name}: missing acceptance evidence`);
        if (!plan.text.includes("## Verification"))
          errors.push(`plans/done/${name}: missing verification`);
        const ids = [...spec.text.matchAll(/\bAC-[A-Z0-9-]+\b/g)].map(
          (match) => match[0],
        );
        for (const id of new Set(ids))
          if (!plan.text.includes(id))
            errors.push(
              `plans/done/${name}: missing evidence mapping for ${id}`,
            );
      }
      if (
        state === "done" &&
        plan.meta.outcome !== "completed" &&
        !plan.text.includes("## Closure reason")
      )
        errors.push(
          `plans/done/${name}: terminal non-completion needs Closure reason`,
        );
    }
  }

  const activeNames = new Set(
    records
      .filter((record) => record.state === "active")
      .map((record) => record.name),
  );
  for (const record of records.filter((entry) => entry.state === "done"))
    if (activeNames.has(record.name))
      errors.push(`${record.name}: exists in active and done`);
  return errors;
}

function selfTest() {
  const specText = `---\nwork_id: demo\nstatus: done\nstage: done\noutcome: completed\ncomplexity: complex\ncreated: 2026-07-27\nupdated: 2026-07-27\nowner: test\n---\n\n## EARS acceptance criteria\n\n- **AC-DEMO-001 — Event-driven:** When a request arrives, Titen shall respond.\n`;
  const planText = `---\nwork_id: demo\nstatus: done\nstage: done\noutcome: completed\ncomplexity: complex\ncreated: 2026-07-27\nupdated: 2026-07-27\nowner: test\nspec: docs/specs/done/demo.md\n---\n\n- [x] Complete.\n\n## Acceptance evidence\n\nAC-DEMO-001 passed.\n\n## Verification\n\nPassed.\n`;
  const valid = [
    {
      kind: "specs",
      state: "done",
      name: "demo.md",
      text: specText,
      meta: parseFrontMatter(specText),
    },
    {
      kind: "plans",
      state: "done",
      name: "demo.md",
      text: planText,
      meta: parseFrontMatter(planText),
    },
  ];
  assert.deepEqual(validate(valid, new Date("2026-07-27T00:00:00Z")), []);
  const broken = structuredClone(valid);
  broken[0].text = broken[0].text.replace(
    "When a request arrives,",
    "After a request arrives,",
  );
  broken[1].text = broken[1].text
    .replace("[x]", "[ ]")
    .replace("AC-DEMO-001 passed.", "Evidence missing.");
  broken[1].meta.spec = "docs/specs/done/wrong.md";
  broken[1].meta.owner = "different-owner";
  const errors = validate(broken, new Date("2026-07-27T00:00:00Z"));
  assert(
    errors.some((error) =>
      error.includes("does not match Event-driven syntax"),
    ),
  );
  assert(errors.some((error) => error.includes("unchecked work")));
  assert(errors.some((error) => error.includes("missing evidence mapping")));
  assert(errors.some((error) => error.includes("spec must be")));
  assert(errors.some((error) => error.includes("spec/plan owner mismatch")));

  const staleText = `---\nwork_id: stale\nstatus: active\nstage: spec\noutcome: pending\ncomplexity: complex\ncreated: 2026-07-01\nupdated: 2026-07-01\nreview_after: 2026-07-15\nowner: test\n---\n\n- **AC-STALE-001 — Ubiquitous:** Titen shall remain testable.\n`;
  const stale = [
    {
      kind: "specs",
      state: "active",
      name: "stale.md",
      text: staleText,
      meta: parseFrontMatter(staleText),
    },
  ];
  assert(
    validate(stale, new Date("2026-07-27T00:00:00Z")).some((error) =>
      error.includes("review_after is overdue"),
    ),
  );
  console.log("workflow checker self-test OK");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const errors = ["specs", "plans"].flatMap((kind) =>
    ["active", "done"].flatMap((state) => load(kind, state)),
  );
  const failures = validate(errors);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`workflow docs OK (${errors.length} artifacts)`);
  }
}
