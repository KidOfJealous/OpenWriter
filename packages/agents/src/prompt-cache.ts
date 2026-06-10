import type { WritingContextPacket } from '@openwriter/core';

export function formatStableProjectPrefix(context: WritingContextPacket): string {
  const style = context.projectProfile.style;
  const styleRules = [
    style?.proseProfile ? `- prose profile: ${style.proseProfile}` : '',
    style?.descriptionDensity ? `- description density: ${style.descriptionDensity}` : '',
    style?.dialogueStyle ? `- dialogue style: ${style.dialogueStyle}` : '',
    style?.pov ? `- POV: ${style.pov}` : '',
    style?.taboo?.length ? `- taboo: ${style.taboo.join('; ')}` : '',
  ].filter(Boolean).join('\n');

  return [
    '# Stable Project Context',
    `project: ${context.projectProfile.name}`,
    `language: ${context.projectProfile.language}`,
    `genre: ${context.projectProfile.genre}`,
    '',
    '## Writing Rules',
    '- Do not introduce major canon unless the task explicitly asks for it.',
    '- Do not change established timelines or character relationships casually.',
    '- Prefer continuity with the supplied canon over inventing convenient facts.',
    styleRules,
    '',
    '## Constraints',
    context.constraints.join('\n'),
  ].filter(Boolean).join('\n');
}

export function formatStableCanonPrefix(context: WritingContextPacket): string {
  if (!context.relevantCanon.length) return '';
  return [
    '# Stable Canon Prefix',
    ...context.relevantCanon.map(entry => [
      `## ${entry.source} (${entry.status})`,
      entry.content,
    ].join('\n')),
  ].join('\n\n');
}

export function formatDraftContext(context: WritingContextPacket): string {
  if (!context.relevantDrafts.length) return '';
  return [
    '# Current Draft Context',
    ...context.relevantDrafts.map(entry => [
      `## ${entry.source}`,
      entry.content,
    ].join('\n')),
  ].join('\n\n');
}
