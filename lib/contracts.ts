import { Theme, Contact, contrastRatio, actionText } from './menu-design';
export { palettePresets, contrastRatio, catalogTheme, actionText, publishNameValid, publishNameMessage, isRestaurantOpen } from './menu-design';
import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const singleLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) =>
        !value.includes('\r') &&
        !value.includes('\n') &&
        !value.includes(String.fromCharCode(0)),
      'Usa una sola línea sin caracteres de control.',
    );

// Migration-only. New records are always served on the web.
export const Mode = z.enum(['web', 'local', 'text', 'dual_web_vcard']);
export type Mode = z.infer<typeof Mode>;
export const Feature = z.enum(['orders', 'promotions']);
export type Feature = z.infer<typeof Feature>;
export const Asset = z
  .string()
  .regex(
    /^(|\/demo\/encebollado\.jpg|\/demo\/platos\/[a-z0-9-]+\.webp|(?:\/r\/[a-f0-9-]{36})?\/api\/v1\/media\/[a-f0-9-]{36})$/,
  );

export const ModifierOption = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  priceDeltaCents: z.number().int().min(0).max(9_999_999),
  available: z.boolean(),
});
export type ModifierOption = z.infer<typeof ModifierOption>;

export const ModifierGroup = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    description: z.string().max(180),
    selection: z.enum(['single', 'multiple']),
    minSelections: z.number().int().min(0).max(30),
    maxSelections: z.number().int().min(1).max(30),
    options: z.array(ModifierOption).min(1).max(30),
  })
  .superRefine((group, context) => {
    if (group.minSelections > group.maxSelections)
      context.addIssue({
        code: 'custom',
        message: `El mínimo de “${group.name}” supera el máximo.`,
      });
    if (group.maxSelections > group.options.length)
      context.addIssue({
        code: 'custom',
        message: `El máximo de “${group.name}” supera sus opciones.`,
      });
    if (
      group.selection === 'single' &&
      (group.maxSelections !== 1 || group.minSelections > 1)
    )
      context.addIssue({
        code: 'custom',
        message: `“${group.name}” es de selección única.`,
      });
    if (
      new Set(group.options.map((option) => option.id)).size !==
      group.options.length
    )
      context.addIssue({
        code: 'custom',
        message: `Hay opciones duplicadas en “${group.name}”.`,
      });
  });
export type ModifierGroup = z.infer<typeof ModifierGroup>;

export const Dish = z.object({
  id,
  name: z.string().trim().min(1).max(90),
  description: z.string().max(500),
  categoryId: id,
  priceCents: z.number().int().min(0).max(9_999_999),
  available: z.boolean(),
  image: Asset,
  modifierGroups: z.array(ModifierGroup).max(12).default([]),
});
export type Dish = z.infer<typeof Dish>;

export const Promotion = z
  .object({
    id,
    dishId: z.union([id, z.literal('')]),
    kind: z.enum(['banner','notice','offer','discount']).optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(220),
    badge: singleLine(30),
    image: Asset,
    promotionalPriceCents: z.number().int().min(0).max(9_999_999).nullable(),
    startsAt: z.string().check(z.iso.datetime()).nullable(),
    endsAt: z.string().check(z.iso.datetime()).nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((promotion, context) => {
    if (['banner','notice'].includes(promotion.kind || '') && promotion.promotionalPriceCents !== null) context.addIssue({code:'custom',message:'Un banner o aviso no puede modificar precios.'});
    if (['offer','discount'].includes(promotion.kind || '') && (!promotion.dishId || promotion.promotionalPriceCents === null)) context.addIssue({code:'custom',message:'La oferta o descuento requiere plato y precio explícitos.'});
    if (
      promotion.startsAt &&
      promotion.endsAt &&
      Date.parse(promotion.startsAt) >= Date.parse(promotion.endsAt)
    )
      context.addIssue({
        code: 'custom',
        message: `La fecha final de “${promotion.title}” debe ser posterior al inicio.`,
      });
  });
export type Promotion = z.infer<typeof Promotion>;

export function activePromotion(
  catalog: Catalog,
  dishId: string,
  at = new Date(),
) {
  const timestamp = at.getTime();
  return catalog.promotions.find(
    (promotion) =>
      promotion.enabled &&
      !['banner','notice'].includes(promotion.kind || '') &&
      promotion.dishId === dishId &&
      (!promotion.startsAt || Date.parse(promotion.startsAt) <= timestamp) &&
      (!promotion.endsAt || Date.parse(promotion.endsAt) > timestamp),
  );
}

export const Catalog = z
  .object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().max(180),
    nameConfirmed: z.boolean().optional(),
    theme: Theme.optional(),
    template: z.enum(['list','cards','compact']).optional(),
    textSize: z.enum(['normal','large']).optional(),
    contact: Contact.optional(),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    logo: Asset,
    categories: z
      .array(z.object({ id, name: z.string().trim().min(1).max(50) }))
      .min(1)
      .max(30),
    dishes: z.array(Dish).max(150),
    promotions: z.array(Promotion).max(8).default([]),
  })
  .superRefine((value, context) => {
    if(value.theme) { const t=value.theme; if (contrastRatio(t.text,t.background)<4.5 || contrastRatio(t.text,t.surface)<4.5 || contrastRatio(t.accent,t.surface)<3 || contrastRatio(t.action,actionText(t.action))<4.5) context.addIssue({code:'custom',message:'Los colores no alcanzan el contraste mínimo legible.'}); }
    const categoryNames=value.categories.map(c=>c.name.normalize('NFKD').replace(/[\u0300-\u036f\p{Cf}]/gu,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('es'));
    if(categoryNames.some(n=>!n)||new Set(categoryNames).size!==categoryNames.length)context.addIssue({code:'custom',message:'Las categorías deben tener nombres visibles y diferentes.'});
    const categories = new Set(value.categories.map((item) => item.id));
    if (
      categories.size !== value.categories.length ||
      new Set(value.dishes.map((item) => item.id)).size !== value.dishes.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Hay identificadores duplicados.',
      });
    if (value.dishes.some((item) => !categories.has(item.categoryId)))
      context.addIssue({
        code: 'custom',
        message: 'Un plato tiene una categoría inexistente.',
      });
    const dishes = new Map(value.dishes.map((dish) => [dish.id, dish]));
    for (const promotion of value.promotions) {
      const dish = dishes.get(promotion.dishId);
      if (!dish && !['banner','notice'].includes(promotion.kind || ''))
        context.addIssue({
          code: 'custom',
          message: `La promoción “${promotion.title}” apunta a un plato inexistente.`,
        });
      if (
        dish &&
        promotion.promotionalPriceCents !== null &&
        promotion.promotionalPriceCents >= dish.priceCents
      )
        context.addIssue({
          code: 'custom',
          message: `El precio promocional de “${promotion.title}” debe ser menor al precio normal.`,
        });
    }
    for (let index = 0; index < value.promotions.length; index++) {
      const left = value.promotions[index];
      if (!left.enabled || left.promotionalPriceCents === null) continue;
      for (const right of value.promotions.slice(index + 1)) {
        if (!right.enabled || right.promotionalPriceCents === null || right.dishId !== left.dishId) continue;
        const leftStart = left.startsAt ? Date.parse(left.startsAt) : -Infinity;
        const leftEnd = left.endsAt ? Date.parse(left.endsAt) : Infinity;
        const rightStart = right.startsAt
          ? Date.parse(right.startsAt)
          : -Infinity;
        const rightEnd = right.endsAt ? Date.parse(right.endsAt) : Infinity;
        if (leftStart < rightEnd && rightStart < leftEnd)
          context.addIssue({
            code: 'custom',
            message: `Las promociones “${left.title}” y “${right.title}” se superponen.`,
          });
      }
    }
    for (const dish of value.dishes)
      if (
        new Set(dish.modifierGroups.map((group) => group.id)).size !==
        dish.modifierGroups.length
      )
        context.addIssue({
          code: 'custom',
          message: `Hay grupos duplicados en “${dish.name}”.`,
        });
  });
export type Catalog = z.infer<typeof Catalog>;

export function normalizeCatalog(value: unknown): Catalog {
  const raw = value as Record<string, unknown>;
  const dishes = Array.isArray(raw?.dishes)
    ? raw.dishes.map((dish) => ({
        ...(dish as Record<string, unknown>),
        modifierGroups: Array.isArray(
          (dish as Record<string, unknown>).modifierGroups,
        )
          ? (dish as Record<string, unknown>).modifierGroups
          : [],
      }))
    : [];
  return Catalog.parse({
    ...raw,
    dishes,
    promotions: Array.isArray(raw?.promotions) ? raw.promotions : [],
  });
}

export const Settings = z.object({
  webUrl: z.union([
    z.literal(''),
    z
      .string()
      .check(z.url())
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      }, 'La dirección web debe usar HTTPS.'),
  ]),
  ordersEnabled: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;
export const defaultSettings: Settings = { webUrl: '', ordersEnabled: false };
export function normalizeSettings(value: unknown): Settings {
  const raw = (value || {}) as Record<string, unknown>;
  return Settings.parse({
    webUrl: typeof raw.webUrl === 'string' ? raw.webUrl : '',
    ordersEnabled: raw.ordersEnabled === true,
  });
}

export const LicensePayload = z.object({
  schemaVersion: z.literal(1),
  restaurantId: id,
  licenseId: id,
  modes: z.array(Mode).min(1).max(4),
  issuedAt: z.string().check(z.iso.datetime()),
  customer: z.string().min(1).max(120),
});
export type LicensePayload = z.infer<typeof LicensePayload>;
export const License = z.object({
  payload: z.string().max(4096),
  signature: z.string().max(256),
});
export type License = z.infer<typeof License>;

export const Backup = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  sourceId: id,
  exportedAt: z.string().check(z.iso.datetime()),
  draft: Catalog,
  settings: Settings,
  media: z
    .array(
      z.object({
        id: z.string().check(z.uuid()),
        type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        data: z.string().max(1_500_000),
      }),
    )
    .max(151),
});

export const blankCatalog: Catalog = {
  name: 'Mi restaurante',
  tagline: 'Sabores que nos reúnen.',
  color: '#244130',
  logo: '',
  categories: [
    { id: 'principales', name: 'Platos principales' },
    { id: 'bebidas', name: 'Bebidas' },
  ],
  dishes: [],
  promotions: [],
};

const optionId = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
const includedOptions = (names: string[]) =>
  names.map((name) => ({
    id: optionId(name),
    name,
    priceDeltaCents: 0,
    available: true,
  }));
export const demoCatalog: Catalog = {
  ...blankCatalog,
  name: 'La Mesa',
  tagline: 'Cocina ecuatoriana, hecha con cariño.',
  categories: [
    { id: 'desayunos', name: 'Desayunos' },
    { id: 'principales', name: 'Nuestra cocina' },
    { id: 'bebidas', name: 'Para acompañar' },
  ],
  dishes: [
    {
      id: 'desayuno-continental',
      name: 'Desayuno continental',
      description: 'Pan, fruta y dos bebidas elegidas a tu gusto.',
      categoryId: 'desayunos',
      priceCents: 650,
      available: true,
      image: '',
      modifierGroups: [
        {
          id: 'bebida-caliente',
          name: 'Bebida caliente',
          description: 'Elige una bebida.',
          selection: 'single',
          minSelections: 1,
          maxSelections: 1,
          options: includedOptions(['Café', 'Leche', 'Agua aromática']),
        },
        {
          id: 'jugo',
          name: 'Jugo',
          description: 'Elige un sabor.',
          selection: 'single',
          minSelections: 1,
          maxSelections: 1,
          options: includedOptions(['Naranja', 'Sandía', 'Fresa']),
        },
        {
          id: 'extras',
          name: 'Extras',
          description: 'Añade hasta dos extras.',
          selection: 'multiple',
          minSelections: 0,
          maxSelections: 2,
          options: [
            {
              id: 'huevo',
              name: 'Huevo',
              priceDeltaCents: 100,
              available: true,
            },
            {
              id: 'queso',
              name: 'Queso',
              priceDeltaCents: 75,
              available: true,
            },
            {
              id: 'fruta',
              name: 'Fruta adicional',
              priceDeltaCents: 125,
              available: true,
            },
          ],
        },
      ],
    },
    {
      id: 'encebollado',
      name: 'Encebollado de la casa',
      description: 'Albacora, yuca suave, cebolla encurtida y limón.',
      categoryId: 'principales',
      priceCents: 650,
      available: true,
      image: '/demo/encebollado.jpg',
      modifierGroups: [],
    },
    {
      id: 'seco',
      name: 'Seco de pollo',
      description: 'Cocción lenta con especias, arroz amarillo y maduro.',
      categoryId: 'principales',
      priceCents: 750,
      available: true,
      image: '',
      modifierGroups: [],
    },
    {
      id: 'jugo',
      name: 'Jugo de maracuyá',
      description: 'Fruta natural, preparado al momento.',
      categoryId: 'bebidas',
      priceCents: 250,
      available: true,
      image: '',
      modifierGroups: [],
    },
  ],
  promotions: [
    {
      id: 'promo-desayuno',
      dishId: 'desayuno-continental',
      title: 'Empieza el día a tu gusto',
      description:
        'Configura tu bebida caliente, elige tu jugo favorito y ahorra.',
      badge: 'PROMOCIÓN DEL DÍA',
      image: '',
      promotionalPriceCents: 595,
      startsAt: null,
      endsAt: null,
      enabled: true,
    },
  ],
};

export const money = (cents: number) =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );

export const OrderSelection = z.object({
  groupId: id,
  optionIds: z.array(id).max(30),
});
export const OrderLineInput = z.object({
  dishId: id,
  quantity: z.number().int().min(1).max(99),
  selections: z.array(OrderSelection).max(12),
  note: singleLine(240),
});
export const CreateOrderInput = z.object({
  alias: singleLine(80).trim().min(1, 'Escribe tu nombre o alias.'),
  lines: z.array(OrderLineInput).min(1).max(100),
  expectedTotalCents: z.number().int().min(0).max(999_999_999),
  operationKey: z.uuid().optional(),
  menuVersion: z.number().int().nonnegative().optional(),
  demo: z.boolean().optional(),
  turnstileToken: z.string().max(4096).optional(),
}).strict();
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
