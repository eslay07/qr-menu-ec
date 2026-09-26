import { mkdir, writeFile } from 'node:fs/promises';
import { orderPdf } from '../lib/order-pdf';
import type { OrderRecord } from '../lib/orders';

const order: OrderRecord = {
  id: 'pdf-fixture',
  restaurantId: 'restaurante-demo',
  number: 'PED-DEMO-1042',
  status: 'confirmed',
  demo: true,
  alias: 'Mesa 7',
  restaurantName: 'La Mesa',
  menuVersion: 1,
  currency: 'USD',
  totalCents: 1525,
  createdAt: '2026-09-26T17:30:00.000Z',
  publicExpiresAt: '2026-09-27T17:30:00.000Z',
  cancelledAt: null,
  lines: [
    {
      id: 'linea-desayuno',
      dishId: 'desayuno-continental',
      dishName: 'Desayuno continental',
      basePriceCents: 650,
      quantity: 2,
      options: [
        {
          groupId: 'bebida-caliente',
          groupName: 'Bebida caliente',
          optionId: 'cafe',
          optionName: 'Café',
          priceDeltaCents: 0,
        },
        {
          groupId: 'jugo',
          groupName: 'Jugo',
          optionId: 'naranja',
          optionName: 'Naranja',
          priceDeltaCents: 0,
        },
      ],
      note: 'Uno sin azúcar.',
      unitPriceCents: 650,
      totalCents: 1300,
    },
    {
      id: 'linea-jugo',
      dishId: 'jugo',
      dishName: 'Jugo de maracuyá',
      basePriceCents: 225,
      quantity: 1,
      options: [],
      note: '',
      unitPriceCents: 225,
      totalCents: 225,
    },
  ],
};

await mkdir('output/pdf', { recursive: true });
await writeFile('output/pdf/pedido-demo-verificado.pdf', await orderPdf(order));
