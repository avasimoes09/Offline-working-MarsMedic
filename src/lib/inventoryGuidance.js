const SUPPORTIVE_SUPPLIES = [
  {
    label: 'Hydration support',
    symptomPattern: /\b(?:vomiting|vomit|diarrhea|diarrhoea)\b/i,
    itemPattern: /\b(?:oral rehydration|electrolyte solution|rehydration salts|ors)\b/i,
  },
  {
    label: 'Basic wound care',
    symptomPattern: /\b(?:wound|burn)\b/i,
    itemPattern: /\b(?:bandage|gauze|sterile dressing|saline|wound dressing)\b/i,
  },
  {
    label: 'Monitoring',
    symptomPattern: /\b(?:fever|shortness of breath|chest pain|palpitations|dizziness)\b/i,
    itemPattern: /\b(?:thermometer|pulse oximeter|oximeter|blood pressure monitor|bp cuff)\b/i,
  },
];

export function getRelevantInventorySupport(inventoryItems = [], selectedSymptomLabels = []) {
  const availableItems = inventoryItems.filter((item) => Number(item?.quantity) > 0);
  const selectedText = selectedSymptomLabels.join(' ');
  const matches = [];

  for (const support of SUPPORTIVE_SUPPLIES) {
    if (!support.symptomPattern.test(selectedText)) continue;
    const items = availableItems.filter((item) => (
      support.itemPattern.test(`${item.name || ''} ${item.description || ''}`)
    ));
    if (items.length) matches.push({ label: support.label, items: items.map((item) => item.name) });
  }

  return matches;
}
