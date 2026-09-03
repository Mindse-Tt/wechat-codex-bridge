import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export function scanAllSkills(): SkillInfo[] {
  const roots = [join(homedir(), '.codex', 'skills'), join(homedir(), '.agents', 'skills')];
  const seen = new Set<string>();
  return roots.flatMap(scanRoot).filter((skill) => {
    if (seen.has(skill.name)) return false;
    seen.add(skill.name);
    return true;
  });
}

export function formatSkillList(skills: SkillInfo[]): string {
  return skills.map((skill, index) => `  ${index + 1}. ${skill.name}${skill.description ? ` - ${skill.description}` : ''}`).join('\n');
}

export function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
  return skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
}

function scanRoot(root: string): SkillInfo[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry: Dirent) => parseSkill(join(root, entry.name)));
}

function parseSkill(path: string): SkillInfo[] {
  try {
    const content = readFileSync(join(path, 'SKILL.md'), 'utf8');
    const name = /^name:\s*(.+)$/m.exec(content)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    const description = /^description:\s*(.+)$/m.exec(content)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
    return name ? [{ name, description, path }] : [];
  } catch {
    return [];
  }
}
