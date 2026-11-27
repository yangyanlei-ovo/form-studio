/**
 * Built-in prompt policy for FORM's Seedream renders.
 *
 * The user's own prompt stays in whatever language they typed. Everything this
 * module adds is English. Seedream's image API has no separate negative_prompt
 * field, so the negative list is appended to the prompt as an AVOID section.
 */

export const PROMPT_VERSION = '2026-11-23.simple';
export const MAX_PROMPT_CHARS = 4_000;

export const BUILTIN_POSITIVE = [
  'Photoreal architectural interior photograph; complete, richly detailed and coherent with the requested style.',
  'Attached image: massing reference for camera, placement, proportions and base colors only.',
  'Do NOT copy its blocks, voxels, pixels, grid, wireframe or low-poly style.',
  'Keep every described major object\'s position, count and scale; enrich materials, lighting and restrained styling without changing the layout.',
  'Replace block proxies with finished furniture: realistic curved edges, joinery, seams, fabric weave, wood grain, stone and glass reflections.',
  'Use layered daylight and practical light, global illumination, contact shadows, ambient occlusion, straight verticals and realistic perspective.',
  'Design a complete ceiling with credible height and cove/detail joints; finish walls with appropriate panels, plaster or artwork; place coordinated luminaires with plausible mounts, wiring and light direction.',
  'Style individual furniture with tasteful books, ceramics, cushions, throws and small accessories appropriate to function. Keep circulation clear. Add layered daylight, ambient, task and accent light with realistic exposure and soft contact shadows.',
  'User request controls style, mood, materials and color; reduce styling for minimal/empty requests. Do not move major furniture; do not force a specific style.',
].join(' ');

export const BUILTIN_POSITIVE_STYLE = [
  'Photorealistic high-end interior photograph, fully resolved.',
  'Image 1 is the new camera/layout blockout; image 2 is the approved style reference.',
  'Use image 1 and the scene brief for camera, geometry, object positions and scale; match image 2\'s materials, colors, lighting, decor and detail level.',
  'Change only the camera angle; keep the style consistent. Do not copy image 2\'s framing or block/pixel style.',
  'CAMERA LOCK: the camera, perspective, horizon, framing and object layout must match image 1 exactly; never take the camera from image 2.',
  'User request may adjust details; do not add, remove or move major furniture.',
].join(' ');

export const BUILTIN_POSITIVE_STYLE_ONLY = [
  'Photorealistic high-end interior photograph, fully resolved.',
  'The supplied image is the approved style reference.',
  'Use the scene brief for camera, geometry, object positions and scale; match the reference\'s materials, colors, lighting, decor and detail level.',
  'Change only the camera angle; keep the style consistent. Do not copy its framing or block/pixel style.',
  'User request may adjust details; do not add, remove or move major furniture.',
].join(' ');

export const BUILTIN_NEGATIVE = [
  'pixel art',
  'voxel blocks',
  'Minecraft',
  'low-poly cubes',
  'visible grid',
  'wireframe',
  'blueprint',
  'schematic',
  'text',
  'watermark',
  'logo',
  'UI',
  'duplicate furniture',
  'floating objects',
  'clipping',
  'wrong perspective',
  'fisheye',
  'cartoon',
  'illustration',
  'oversaturation',
  'noise',
  'flat lighting',
  'unfinished surfaces',
  'unintentional bare proxy geometry',
  'low detail',
  'synthetic waxy material',
  'unmotivated light sources',
  'blown highlights',
  'floating decor',
  'people',
  'crowds',
];

const PEOPLE_PATTERN = /people|human|crowd|person/i;

/**
 * Compose the final prompt. User text is preserved as typed; built-in text,
 * the computed scene brief, and negatives are English.
 */
export function composePrompt({
  userPrompt = '',
  negativePrompt = '',
  sceneBrief = '',
  allowPeople = false,
  hasReferenceImage = true,
} = {}) {
  const negativeExtras = String(negativePrompt)
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const builtinNegatives = BUILTIN_NEGATIVE.filter((item) => (allowPeople ? !PEOPLE_PATTERN.test(item) : true));
  const negatives = [...builtinNegatives, ...negativeExtras];
  const referenceRole = hasReferenceImage
    ? 'REFERENCE IMAGE ROLE: the supplied image is the current camera/geometry blockout. Use it for perspective, framing, object positions, proportions and base colors only. Do not copy its block, voxel, grid, wireframe or low-poly appearance.'
    : 'REFERENCE IMAGE ROLE: scene coordinates control camera and geometry. Do not invent block, voxel, grid, wireframe or low-poly appearance.';

  const build = (sceneText) => {
    const parts = [
      BUILTIN_POSITIVE,
      '',
      referenceRole,
      '',
      'SCENE BRIEF (computed from the live model at generation time; coordinates in meters, 1 grid = 0.5 m):',
      String(sceneText).trim() || '(not provided)',
      '',
      'USER REQUEST:',
      String(userPrompt).trim() || '(no additional style request)',
      '',
    ];
    if (allowPeople) {
      parts.push('PEOPLE: people may appear naturally if the scene calls for them, but they must stay secondary to the interior.');
      parts.push('');
    }
    parts.push('AVOID: ' + [...new Set(negatives)].join(', ') + '.');
    return parts.join('\n');
  };

  let prompt = build(sceneBrief);
  if (prompt.length > MAX_PROMPT_CHARS) {
    const compact = String(sceneBrief)
      .split('\n')
      .filter((line) => !line.startsWith('L=left') && !line.startsWith('Objects ('))
      .map((line) => {
        const columns = line.split('|');
        if (columns.length === 7 && /^(block|wall|floor|window)$/i.test(columns[1])) {
          return columns.slice(0, 4).join('|');
        }
        return line;
      })
      .join('\n');
    prompt = build(
      'STRUCTURAL LINES: id|type|size|center (mass colours/sides come from the reference image); ' +
        'FURNITURE LINES: id|type|size|center|color|screen|depth.\n' +
        compact,
    );
    if (prompt.length > MAX_PROMPT_CHARS) {
      const structural = compact.split('\n').filter(line => /^\d+\|(block|wall|floor|window)\|/.test(line));
      const furniture = compact.split('\n').filter(line => !/^\d+\|(block|wall|floor|window)\|/.test(line));
      prompt = build(`Structural proxies: ${structural.length}; follow reference geometry.\n${furniture.join('\n')}`);
    }
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    const error = new Error(`最终提示词过长（${prompt.length} 字符，上限 ${MAX_PROMPT_CHARS}）。请缩短用户描述或负面词，或减少场景物体。`);
    error.code = 'PROMPT_TOO_LONG';
    throw error;
  }
  return prompt;
}

