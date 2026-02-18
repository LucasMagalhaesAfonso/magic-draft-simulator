import type { Card, CardFace, CardRow, Color, Rarity } from './types';

function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

export function rowToCard(row: CardRow): Card {
  const card: Card = {
    id: row.id,
    oracle_id: row.oracle_id || '',
    name: row.name,
    mana_cost: row.mana_cost || '',
    cmc: row.cmc || 0,
    type_line: row.type_line || '',
    oracle_text: row.oracle_text || '',
    power: row.power || undefined,
    toughness: row.toughness || undefined,
    loyalty: row.loyalty || undefined,
    colors: parseJsonArray<Color>(row.colors),
    color_identity: parseJsonArray<Color>(row.color_identity),
    keywords: parseJsonArray<string>(row.keywords),
    set_code: row.set_code,
    set_name: row.set_name || '',
    collector_number: row.collector_number || '',
    rarity: (row.rarity || 'common') as Rarity,
    image_small: row.image_small || '',
    image_normal: row.image_normal || '',
    image_art_crop: row.image_art_crop || '',
    layout: row.layout || 'normal',
    produced_mana: parseJsonArray<Color>(row.produced_mana),
  };

  if (row.back_face_name) {
    card.back_face = {
      name: row.back_face_name,
      mana_cost: row.back_face_mana_cost || '',
      type_line: row.back_face_type_line || '',
      oracle_text: row.back_face_oracle_text || '',
      power: row.back_face_power || undefined,
      toughness: row.back_face_toughness || undefined,
      image_normal: row.back_face_image_normal || undefined,
    } as CardFace;
  }

  return card;
}
