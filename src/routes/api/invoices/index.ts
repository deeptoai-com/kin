import { createFileRoute } from '@tanstack/react-router';
import { listOrdersByExternalCustomerId } from '~/server/polar';
import { requireUser } from '~/server/require-user';

export const Route = createFileRoute('/api/invoices/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request);

        const orders = await listOrdersByExternalCustomerId(user.id, 50);

        const items = orders.map((order) => ({
          id: order.id,
          orderId: order.id,
          date: new Date(order.createdAt).toLocaleString(),
          amount: `${((order.totalAmount ?? 0) / 100).toFixed(2)} ${order.currency ?? 'USD'}`,
          hostedUrl: null,
          pdfUrl: null,
          isInvoiceGenerated: order.isInvoiceGenerated,
        }));

        return Response.json(items);
      },
    },
  },
});
