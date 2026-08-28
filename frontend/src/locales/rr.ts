import en from './en';

type TranslationNode = string | TranslationNode[] | { [key: string]: TranslationNode };

function rawrifyWord(word: string): string {
  const extraRs = Math.min(6, Math.max(0, Math.floor(word.length / 3)));
  const base = `rawr${'r'.repeat(extraRs)}`;
  return /^[A-Z]/.test(word) ? base.toUpperCase() : base;
}

function rawrifyText(input: string): string {
  const parts = input.split(/(\{\{[^}]+\}\})/g);
  return parts
    .map((part) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return part;
      }
      return part.replace(/[A-Za-z]+/g, rawrifyWord);
    })
    .join('');
}

function rawrifyNode(node: TranslationNode): TranslationNode {
  if (typeof node === 'string') {
    return rawrifyText(node);
  }

  if (Array.isArray(node)) {
    return node.map(rawrifyNode);
  }

  const entries = Object.entries(node).map(([key, value]) => [key, rawrifyNode(value)] as const);
  return Object.fromEntries(entries);
}

const rr = rawrifyNode(en as TranslationNode) as typeof en;

export default rr;
