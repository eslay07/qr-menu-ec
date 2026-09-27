import { demoCatalog, type Catalog, type Dish } from './contracts';

// Illustrative menu for stress testing. Every item has a stable, unique ID.
const examples: Array<[string, string, number, string]> = [
  ['Desayuno continental', 'desayunos', 650, 'desayuno'], ['Bolón de queso', 'desayunos', 450, 'bolon'],
  ['Tigrillo', 'desayunos', 550, 'tigrillo'], ['Humita con queso', 'desayunos', 350, 'humita'],
  ['Empanadas de viento', 'desayunos', 300, 'empanadas'], ['Café pasado', 'desayunos', 190, 'cafe'],
  ['Seco de pollo', 'principales', 750, 'seco'], ['Llapingachos', 'principales', 650, 'llapingachos'],
  ['Hornado', 'principales', 850, 'hornado'], ['Guatita', 'principales', 700, 'guatita'],
  ['Fritada', 'principales', 850, 'fritada'], ['Chaulafán', 'principales', 750, 'chaulafan'],
  ['Encebollado', 'mariscos', 650, 'encebollado'], ['Ceviche de camarón', 'mariscos', 900, 'ceviche'],
  ['Encocado de pescado', 'mariscos', 950, 'encocado'], ['Arroz marinero', 'mariscos', 1100, 'arroz-marinero'],
  ['Hamburguesa artesanal', 'rapida', 690, 'hamburguesa'], ['Pizza margarita', 'rapida', 790, 'pizza'],
  ['Ensalada con pollo', 'rapida', 680, 'ensalada'], ['Empanadas de la casa', 'rapida', 380, 'empanadas'],
  ['Jugo de maracuyá', 'bebidas', 250, 'jugo-maracuya'], ['Batido de fresa', 'bebidas', 350, 'batido-fresa'],
  ['Café con leche', 'bebidas', 220, 'cafe'], ['Jugo de naranja', 'bebidas', 250, 'jugo-maracuya'],
  ['Pastel de tres leches', 'postres', 390, 'tres-leches'], ['Fruta fresca', 'postres', 320, 'ensalada'],
];

export function professionalSample(name: string, maxDishes: number): Catalog {
  const count = Math.max(1, Math.min(150, maxDishes));
  const dishes: Dish[] = Array.from({ length: count }, (_, index) => {
    const [title, categoryId, priceCents, image] = examples[index % examples.length];
    const batch = Math.floor(index / examples.length);
    const base = demoCatalog.dishes.find(d => d.name === title);
    return {
      id: `ejemplo-${index + 1}`,
      name: batch ? `${title} · alternativa ${batch + 1}` : title,
      description: base?.description || 'Ejemplo ilustrativo: ajusta ingredientes, disponibilidad y precio antes de publicar.',
      categoryId,
      priceCents: priceCents + batch * 50,
      available: true,
      image: image === 'encebollado' ? '/demo/encebollado.jpg' : `/demo/platos/${image}.webp`,
      modifierGroups: index === 0 ? structuredClone(demoCatalog.dishes[0].modifierGroups) : [],
    };
  });
  return {
    ...demoCatalog,
    name,
    categories: [
      { id: 'desayunos', name: 'Desayunos' }, { id: 'principales', name: 'Platos fuertes' },
      { id: 'mariscos', name: 'Mariscos' }, { id: 'rapida', name: 'Comida rápida' },
      { id: 'bebidas', name: 'Bebidas' }, { id: 'postres', name: 'Postres' },
    ],
    dishes,
    promotions: [],
  };
}
