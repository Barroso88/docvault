const DEFAULT_CATEGORIES = {
  pessoais: { name: 'Pessoais', icon: '📋', color: 'blue' },
  faturas: { name: 'Faturas', icon: '🧾', color: 'emerald' },
  medicos: { name: 'Médicos', icon: '🏥', color: 'rose' },
  veterinario: { name: 'Veterinário', icon: '🐕', color: 'amber' },
  seguros: { name: 'Seguros', icon: '🛡️', color: 'purple' },
  contratos: { name: 'Contratos', icon: '📄', color: 'cyan' },
  financas: { name: 'Finanças', icon: '💰', color: 'green' },
  outros: { name: 'Outros', icon: '📁', color: 'surface' }
};

const DEFAULT_CATEGORY_ORDER = Object.keys(DEFAULT_CATEGORIES);

const ICON_OPTIONS = [
  '📋', '🧾', '🏥', '🐕', '🛡️', '📄', '💰', '📁', '🧑‍💼', '🏠', '🚗', '🎓', '🏛️', '📦', '🧑‍🔧', '🧑‍⚕️', '🧑‍🎓',
  '🧒', '💳', '🪪', '🗂️', '🧠', '⚖️', '🏦', '📞', '🛠️', '💻', '🌿', '🧳', '🏖️', '✈️', '🎫', '🧬', '🧯',
  '🏡', '🏢', '🏥', '🧵', '🪙', '🧷', '📚', '📰', '📝', '🔒', '🔑', '📮', '📅', '🗝️', '🧾', '🛒',
  '🍽️', '👶', '🧓', '🚑', '🚚', '🏆', '🎮', '🎨', '🎵', '📷', '📺', '🛰️', '🧰', '🧪', '🧹'
];

const COLOR_OPTIONS = [
  'blue',
  'emerald',
  'rose',
  'amber',
  'purple',
  'cyan',
  'green',
  'orange',
  'indigo',
  'teal',
  'pink',
  'slate',
  'surface'
];

function slugifyCategoryName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ORDER,
  ICON_OPTIONS,
  COLOR_OPTIONS,
  slugifyCategoryName
};
