const parseTags = (value) => {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '[]';

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch {
      // Fall back to comma-separated values.
    }

    return JSON.stringify(
      trimmed
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    );
  }

  return '[]';
};

const toDocument = (row) => {
  if (!row) return row;
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : []
  };
};

module.exports = {
  parseTags,
  toDocument
};
