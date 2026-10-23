// Avizis — EN-зеркало демо-контента (ADR-022): идентичные структуры и id узлов,
// английские тексты. demo.ts выбирает RU/EN по языку прогона (detectLang задачи).
// Перевод сохраняет все числа, id, домены развилок и ветвление — сценарии
// побайтово детерминированы в обоих языках.
import { DecisionState, GraphNode } from './types'
import type { DemoAdaptation, DemoDecisionInsertion } from './demo'

export const DEFAULT_TASK_EN = 'Analyze the Q3 sales data and find anomalies'
export const WRITING_TASK_EN = 'Write a post announcing the launch of our new feature — a smart assistant in the editor'

// ───────────────────────── Scenario 1: “Data analysis” ─────────────────────────

export const DEMO_DECISION_EN: DecisionState = {
  question:
    'The analysis produced 3 anomaly candidates (a spike on Aug 14, a stall on Sep 2–3, a returns spike on Sep 22). Which strategy should verify them before the final report?',
  domain: 'strategy',
  selection: 'single',
  status: 'pending',
  certaintyAfter: 0.9,
  options: [
    {
      id: 'a',
      label: 'Quick statistical check',
      rationale:
        'Median, IQR and z-score will confirm or rule out the candidates in a single step. Fast and cheap, but the method does not tell business events apart from failures — a risk of misinterpretation in the final report.',
      nextSteps: ['Statistical check (IQR + z-score)'],
    },
    {
      id: 'b',
      label: 'Deep investigation',
      rationale:
        'Each candidate is cross-checked against business events and primary sources (POS logs, CRM). Costlier — two steps instead of one — but it weeds out false positives before the final report.',
      nextSteps: ['Cross-check with business events', 'Cross-verification against sources'],
    },
    {
      id: 'c',
      label: 'Ask the data owner for context',
      rationale:
        'Ask the data owner about known events in the period. Maximum accuracy, but it blocks graph execution until a human replies.',
      nextSteps: ['Context request to the user'],
    },
  ],
}

export const DEMO_AUTO_PICK_EN = {
  optionIds: ['b'] as string[],
  reasoning:
    'The candidates touch revenue: the price of a false positive in the final report exceeds the cost of two extra steps. A deep investigation will cross-check the candidates against business events and weed out false ones before the summary.',
}

export function demoPlanEn(): GraphNode[] {
  const base = {
    status: 'pending' as const,
    dynamic: false,
    runs: 0,
  }
  return [
    { ...base, id: 'n1', title: 'Data and context collection', description: 'Load the source data for the task and take a first look at its quality and completeness.', dependsOn: [] },
    { ...base, id: 'n2', title: 'Analysis and processing', description: 'The main computational step: data analysis, pattern search and anomalies.', dependsOn: ['n1'] },
    {
      ...base,
      id: 'dec1',
      kind: 'decision' as const,
      title: 'Decision: verification strategy',
      description: 'A fork: the agent picks a strategy for verifying anomaly candidates — it determines the further steps and the final result.',
      dependsOn: ['n2'],
      decision: { ...DEMO_DECISION_EN, options: DEMO_DECISION_EN.options.map((o) => ({ ...o })) },
    },
    {
      ...base,
      id: 'b1a',
      title: 'Statistical check (IQR + z-score)',
      description: 'Verify the candidates with statistical methods: median, interquartile range, z-score.',
      dependsOn: ['dec1'],
      branchOf: { decisionId: 'dec1', optionId: 'a' },
    },
    {
      ...base,
      id: 'b1b',
      title: 'Cross-check with business events',
      description: 'Match each candidate against known business events: campaigns, shipments, maintenance windows.',
      dependsOn: ['dec1'],
      branchOf: { decisionId: 'dec1', optionId: 'b' },
    },
    {
      ...base,
      id: 'b2b',
      title: 'Cross-verification against sources',
      description: 'Verify the cross-check conclusions against primary sources: POS and CRM logs.',
      dependsOn: ['b1b'],
      branchOf: { decisionId: 'dec1', optionId: 'b' },
    },
    {
      ...base,
      id: 'b1c',
      title: 'Context request to the user',
      description: 'Ask the data owner about known events of the reporting period and wait for the answer.',
      dependsOn: ['dec1'],
      branchOf: { decisionId: 'dec1', optionId: 'c' },
    },
    {
      ...base,
      id: 'n3',
      title: 'Result assembly',
      description: 'Combine the chosen branch’s conclusions into a final answer with recommendations. Depends on the tails of all branches: runs after the realized one.',
      dependsOn: ['b1a', 'b1b', 'b2b', 'b1c'],
    },
  ]
}

export function demoWritingPlanEn(): GraphNode[] {
  const base = {
    status: 'pending' as const,
    dynamic: false,
    runs: 0,
  }
  return [
    {
      ...base,
      id: 'w1',
      title: 'Request analysis and intake',
      description:
        'Parse the task text: what is known about the product, audience and publication goal. The agent records which text parameters are undefined (format, length, tone, content blocks).',
      dependsOn: [],
    },
    {
      ...base,
      id: 'wfin',
      title: 'Publication draft',
      description:
        'Assemble the text from the chosen parameters: format, content blocks, tone of voice. Its position in the graph is refined as the agent’s questions get answered.',
      dependsOn: ['w1'],
    },
  ]
}

export const DEMO_ADAPTATIONS_EN: DemoAdaptation[] = [
  {
    after: 'n1',
    node: {
      id: 'd1',
      title: 'Data validation',
      description: 'Check completeness and correctness: impute missing values, drop duplicates.',
    },
    reason: 'Missing values and duplicates found in the collected data — without validation the next step would produce a distorted result',
  },
]

export const DEMO_DECISION_INSERTIONS_EN: DemoDecisionInsertion[] = [
  {
    afterAny: ['w1'],
    reason:
      'Request analysis showed the publication format is undefined — a “post” can mean a short note, a longread or a series. The solution vector is blurred, clarification required',
    decision: {
      id: 'decf',
      title: 'Decision: publication format',
      description: 'Emergent fork: the agent clarifies the format after analyzing the request.',
      question:
        'The request does not set a format: a “post” could be a short note, a longread or a series. Which publication format should be chosen?',
      domain: 'format',
      selection: 'single',
      certaintyAfter: 0.45,
      options: [
        {
          id: 'a',
          label: 'Short post (~300 words)',
          rationale:
            'Hook → problem → solution → call to action. Maximum feed reach at minimum production cost; but technical depth has to be cut.',
          steps: [
            { id: 'fa1', title: 'Short-post skeleton', description: 'Hook, conflict, solution, call to action — the text skeleton for a feed format.' },
          ],
        },
        {
          id: 'b',
          label: 'Longread article (~1500 words)',
          rationale:
            'The full product story: context, mechanics, cases, numbers. Better for SEO and authority; costlier in time and demands the reader’s attention.',
          steps: [
            { id: 'fb1', title: 'Longread structure', description: 'Section plan: problem, solution, how it works, a case, takeaways.' },
            { id: 'fb2', title: 'Extended outline', description: 'Per-section theses with target length and argument distribution.' },
          ],
        },
        {
          id: 'c',
          label: 'Series of 3 posts',
          rationale:
            'Three linked publications: announcement → mechanics → case. Keeps the audience’s attention for weeks; but each part needs its own production cycle.',
          steps: [
            { id: 'fc1', title: 'Series plan', description: 'The role of each of the three parts, release order, cross-links.' },
          ],
        },
      ],
    },
  },
  {
    afterAny: ['fa1', 'fb2', 'fc1'],
    reason:
      'The text skeleton is ready, but what fills it is undefined: a case, statistics, the team story and a call to action are all available — the choice of blocks changes length and tone',
    decision: {
      id: 'decb',
      title: 'Decision: content blocks',
      description: 'An emergent fork with a mixed choice: content blocks can be combined.',
      question:
        'What should fill the text? Blocks can be combined — pick one or several (a mixed decision).',
      domain: 'scope',
      selection: 'mixed',
      certaintyAfter: 0.75,
      options: [
        {
          id: 'a',
          label: 'Customer case',
          rationale:
            'A living usage story: trust through specificity. Requires customer approval and a quote or two; without numbers it may look anecdotal.',
          steps: [{ id: 'ba1', title: 'Customer case collection', description: 'Fact-check the customer story, approve quotes, distill the outcome.' }],
        },
        {
          id: 'b',
          label: 'Statistics and numbers',
          rationale:
            'The feature’s measurable effect: work speed, share of accepted edits. Convinces skeptics; needs a data source, otherwise the numbers erode trust.',
          steps: [{ id: 'bb1', title: 'Metrics and numbers selection', description: 'Pick 3–5 measurable feature effects with sources.' }],
        },
        {
          id: 'c',
          label: 'Team story',
          rationale:
            'How the problem was born and solved: humanizes the product. A cheap block to produce; but it proves no value — only works in combination.',
          steps: [{ id: 'bc1', title: 'Team interviews', description: '2–3 facts about how the feature was conceived and user-tested.' }],
        },
        {
          id: 'd',
          label: 'Call to action',
          rationale:
            'An explicit next step for the reader (beta, waitlist, docs). Converts interest; with weak argumentation it feels pushy.',
          steps: [{ id: 'bd1', title: 'CTA wording', description: 'One action, a button/link, risk removal (“try it free”).' }],
        },
      ],
    },
  },
  {
    afterAny: ['ba1', 'bb1', 'bc1', 'bd1'],
    reason:
      'The content is defined, the tone remains: the audience is mixed (developers and product managers), and the text’s voice directly shapes perception',
    decision: {
      id: 'dect',
      title: 'Decision: tone of voice',
      description: 'The final clarification: the publication’s voice.',
      question: 'Which voice should speak to the audience? The tone drives the wording and examples in the draft.',
      domain: 'tone',
      selection: 'single',
      certaintyAfter: 0.95,
      options: [
        {
          id: 'a',
          label: 'Expert and analytical',
          rationale: '“We measured — here are the conclusions.” Carries weight with a technical audience; dryness may reduce broad engagement.',
          steps: [{ id: 'ta1', title: 'Tone calibration: expert', description: 'Terms without oversimplification, emphasis on data and conclusions.' }],
        },
        {
          id: 'b',
          label: 'Friendly, informal',
          rationale: '“Look what we got.” High engagement and response; parts of a corporate audience will find it unserious.',
          steps: [{ id: 'tb1', title: 'Tone calibration: friendly', description: 'Informal address, conversational phrasing, light jokes.' }],
        },
        {
          id: 'c',
          label: 'Bold, provocative',
          rationale: '“Every second editor loses an hour a day — enough of that.” Maximum virality and debate; risks alienating conservative clients.',
          steps: [{ id: 'tc1', title: 'Tone calibration: bold', description: 'Provocative headlines, a challenge to industry habits.' }],
        },
      ],
    },
  },
]

export const DEMO_WRITING_AUTO_PICKS_EN: Record<string, { optionIds: string[]; reasoning: string }> = {
  decf: {
    optionIds: ['a'],
    reasoning:
      'A feature announcement is news with a short lifespan: feeds are read now, while a longread or series stretches the effect. A short post gives maximum reach per unit of effort.',
  },
  decb: {
    optionIds: ['a', 'b'],
    reasoning:
      'A mixed decision: the case builds trust through specificity, statistics add verifiable weight. The team story and a second CTA are redundant for a short post — 3–5 blocks would overload the format.',
  },
  dect: {
    optionIds: ['b'],
    reasoning:
      'The product’s audience is developers and product managers already familiar with the brand: a friendly informal tone raises response in distribution channels, while a bold one carries reputational risk at an announcement.',
  },
}

export const DEMO_INITIAL_CERTAINTY_NOTE_EN: Record<'data' | 'writing', string> = {
  data: 'The task is operational, the metrics are set — the vector is defined, only the verification strategy is open',
  writing: 'The request is vague: format, length, tone and target audience are undefined — the solution vector is wide',
}

/** Scripted node outputs of the EN demo (mirror of demoOutput in demo.ts) */
export function demoOutputEn(node: GraphNode, task: string, picks: Record<string, string[]> = {}): string {
  const fmt = picks.decf?.[0]
  const blocks = picks.decb ?? []
  const tone = picks.dect?.[0]
  const blockNames = (letters: string[]) =>
    letters
      .map((l) => ({ a: 'customer case', b: 'statistics and numbers', c: 'team story', d: 'call to action' })[l]!)
      .join(', ')
  const fmtName = { a: 'short post', b: 'longread', c: 'series of 3 posts' }[fmt ?? ''] ?? 'post'

  switch (node.id) {
    // ─── Scenario 1: data analysis ───
    case 'n1':
      return `Source data collected for the task “${task}”. Volume: 2,847 records for the reporting period. Quality issues found: 14 missing values in the “date” field, 3 duplicate transactions. Without validation the data is unfit for analysis.`
    case 'd1':
      return 'Validation complete: missing values imputed by interpolation, duplicates dropped. 2,830 correct records remain, the reporting period is fully covered. The data is ready for analysis.'
    case 'n2':
      return 'The analysis produced 3 anomaly candidates: (1) an activity spike on Aug 14 — +340% over the median; (2) zero activity on Sep 2–3; (3) a returns outlier on Sep 22 — 8 times the norm. Each candidate needs substantive verification: false positives are a risk.'
    case 'b1a':
      return 'Statistical check: z-scores of the candidates — 4.2 (Aug 14 spike), −5.1 (Sep 2–3 stall), 3.8 (Sep 22 returns); all significant at p<0.01. The method confirms statistical abnormality but does not explain the nature of the events: a business campaign and an outage are indistinguishable. Two candidates were handed over for manual interpretation.'
    case 'b1b':
      return 'Cross-check with business events: Aug 14 — the start of an ad campaign (confirmed by the marketing plan); Sep 2–3 — coincides with a POS maintenance window (the ops schedule); Sep 22 — a large B2B shipment under a contract. All three candidates got context: the source of each event is known.'
    case 'b2b':
      return 'Cross-verification of POS and CRM logs: the Sep 2–3 stall is confirmed as a technical failure — 214 transactions lost, recoverable from the offline backup. Sep 22 returns are within the contractual norm for B2B. The Aug 14 spike is consistent with the campaign figures. False candidates: 0, confirmed anomalies: 1.'
    case 'b1c':
      return 'The data owner’s answer: two events are known — the Aug 14 marketing campaign and the Sep 22 B2B shipment (they explain two candidates). The owner knows nothing about Sep 2–3 — a technical investigation is required. Waiting for the answer took one work cycle.'
    case 'n3':
      switch (picks.dec1?.[0]) {
        case 'a':
          return `The final report for “${task}” was built with the quick strategy. The statistical check confirmed the significance of all 3 candidates but did not explain their nature: the Aug 14 spike and Sep 22 returns were handed over for manual interpretation; the only ready recommendation is the Sep 2–3 stall. Path: fork → statistical check → summary; 3 nodes of the alternative branches were not realized.`
        case 'c':
          return `The final report for “${task}” was built leaning on the data owner’s context. Two candidates are explained by known events (the Aug 14 campaign, the Sep 22 B2B shipment); the Sep 2–3 stall is unexplained — classified as a technical anomaly and handed over for POS log recovery. Path: fork → context request → summary; 3 nodes of the alternative branches were not realized.`
        case 'b':
        default:
          return `The final report for “${task}” was built after a deep investigation. 2 anomalies confirmed: the Sep 2–3 technical failure (214 transactions recoverable from the offline backup) and the Aug 14 spike (a campaign — factor it into the forecast). Sep 22 returns are the norm (a B2B operation), a false positive weeded out before the summary. Path: fork → cross-check → source verification → summary.`
      }

    // ─── Scenario 2: “Write a post” ───
    case 'w1':
      return `The request “${task}” was parsed. Known: the product is a smart editor assistant, the event is the launch. NOT set: the format (“post” is ambiguous), length, tone of voice, audience (developers? product managers? everyone?), the reader’s target action. A list of clarifications was formed — task understanding scored at 20%, the solution vector is blurred.`
    case 'fa1':
      return 'Short-post skeleton: (1) hook — “an hour a day on routine edits”; (2) problem — context switches between sources; (3) solution — an assistant that holds context; (4) CTA — beta access. Length ~300 words, 4 paragraphs.'
    case 'fb1':
      return 'A longread structure of 6 sections: the context of editorial routine → the task → how the mechanics work → an adoption case → numbers → what’s next. Target length ~1500 words.'
    case 'fb2':
      return 'The outline: each section gets 2–3 theses and a target length (200–300 words). The key argument — time saved on fact-checking — is supported by a case and a metric.'
    case 'fc1':
      return 'The series plan: post 1 — announcement and pain (publish immediately); post 2 — mechanics and limitations (in 2 days); post 3 — case and numbers (in a week). Cross-links tie the parts together.'
    case 'ba1':
      return 'Customer case: a news-desk editor cut the review cycle from 40 to 25 minutes — the assistant highlights inconsistent edits and sources. The quote is approved: “I stopped keeping tabs in my head.”'
    case 'bb1':
      return 'Metrics selected: −38% time on proofreading long-form content, 71% of the assistant’s edits accepted as-is, 12,000 texts processed in the beta. Sources — internal telemetry over 60 days.'
    case 'bc1':
      return 'Team story: the 2024 autocorrect fiasco (it replaced “government” in every article) → the conclusion: only a human may change text, an agent only prepares suggestions. Hence the principle: “proposes, never decides.”'
    case 'bd1':
      return 'The CTA is worded: “Try the beta for free” + a waitlist link promising access within 48 hours. Risk removed by the wording “no card required”.'
    case 'ta1':
      return 'Tone calibrated: expert and analytical. Conversational phrasing removed, every thesis is backed by data, terms without oversimplification.'
    case 'tb1':
      return 'Tone calibrated: friendly and informal. Added a direct address to the reader, light conversational turns (“spoiler: it works”), no emoji.'
    case 'tc1':
      return 'Tone calibrated: bold. A challenge headline: “Stop proofreading by hand what a machine sees better.” The provocation targets the habit, not people.'
    case 'wfin': {
      const parts: string[] = []
      parts.push(`The draft is ready with the refined parameters: format — ${fmtName}.`)
      if (blocks.length) parts.push(`Content blocks: ${blockNames(blocks)}.`)
      parts.push(`Tone of voice — ${({ a: 'expert and analytical', b: 'friendly and informal', c: 'bold' })[tone ?? 'b'] ?? 'friendly'}.`)
      parts.push(
        blocks.includes('a') && blocks.includes('b')
          ? 'The case and the numbers reinforce each other: a concrete story + a verifiable metric (−38% proofreading time).'
          : blocks.length === 1
            ? `A single block (${blockNames(blocks)}) carries the argumentation — the text is concise.`
            : 'The text is assembled from the chosen blocks without overlaps.'
      )
      parts.push(
        `The solution vector toward the finale: format → blocks → tone; task understanding grew from 20% to 95%. The parameters are pinned in the decision audit trail.`
      )
      return parts.join(' ')
    }
    default:
      return `Result of the step “${node.title}” for the task “${task}”.`
  }
}
