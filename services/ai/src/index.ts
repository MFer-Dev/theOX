import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId } from '@platform/shared';

const app = Fastify({ logger: true });

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'AI Service', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

app.post('/classify/entry', async () => ({ classification: 'stub' }));
app.post('/truthiness/score', async () => ({ score: 0.5, advisory: true }));

const start = async () => {
  const port = Number(process.env.PORT ?? 4016);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`ai running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start ai');
  process.exit(1);
});

