import { createFileRoute } from '@tanstack/react-router';
import { ensureOrderInvoice, listOrdersByExternalCustomerId } from '~/server/polar';
import { requireUser } from '~/server/require-user';

export const Route = createFileRoute('/api/invoices/$orderId/generate')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const user = await requireUser(request);
        const orders = await listOrdersByExternalCustomerId(user.id, 100);
        const knownOrder = orders.find((order) => order.id === params.orderId);

        if (!knownOrder) {
          return new Response('Invoice not found', { status: 404 });
        }

        const invoice = await ensureOrderInvoice(params.orderId);
        if (!invoice) {
          return new Response('Invoice not available', { status: 503 });
        }

        return Response.json({
          pdfUrl: null,
          hostedUrl: invoice.url ?? null,
        });
      },
    },
  },
});
