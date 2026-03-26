import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "./config.js";
import { InMemorySessionStore } from "./session/store.js";
import { chatHandler } from "./handlers/chat.js";

const app = Fastify({ logger: config.NODE_ENV === "development" });

// Zod type provider — connects Zod schemas to OpenAPI docs
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// CORS
await app.register(cors, { origin: true });

// Swagger / OpenAPI docs at /docs
await app.register(swagger, {
  openapi: {
    info: { title: "UIFlow API", version: "0.0.1", description: "Outcome-driven UI orchestration API" },
    servers: [{ url: `http://localhost:${config.PORT}` }],
  },
  transform: jsonSchemaTransform,
});
await app.register(swaggerUI, { routePrefix: "/docs" });

// Session store (singleton)
const sessionStore = new InMemorySessionStore(config.SESSION_TTL_MS);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ViewportSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number(),
  bearing: z.number().optional(),
  pitch: z.number().optional(),
});

const MapSnapshotSchema = z.object({
  viewport: ViewportSchema,
  markerCount: z.number(),
  markers: z.array(z.object({ id: z.string(), label: z.string() })),
  activeLayers: z.array(z.string()),
  drawingActive: z.boolean(),
});

const PanelSnapshotSchema = z.object({
  contentType: z.enum(["cards", "form", "filters", "table", "text", "empty"]),
  itemCount: z.number(),
  activeWorkflowStep: z.string().nullable(),
});

const ChatRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  surfaceSnapshot: z.object({
    map: MapSnapshotSchema,
    panel: PanelSnapshotSchema,
  }),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post(
  "/api/chat/message",
  {
    schema: {
      summary: "Send a chat message",
      description: "Send a user message and receive an AI response with surface updates",
      tags: ["Chat"],
      body: ChatRequestSchema,
    },
  },
  async (request, reply) => {
    return chatHandler(request as any, reply, sessionStore);
  }
);

app.get(
  "/api/session/:sessionId",
  {
    schema: {
      summary: "Get session info",
      description: "Retrieve session metadata and message history",
      tags: ["Session"],
      params: z.object({ sessionId: z.string() }),
    },
  },
  async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessionStore.get(sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });
    return reply.send({
      id: session.id,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      messageCount: session.messages.length,
      surfaceSnapshot: session.surfaceSnapshot,
    });
  }
);

app.get("/health", { schema: { summary: "Health check", tags: ["System"] } }, async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
}));

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`\n🚀 UIFlow API running at http://localhost:${config.PORT}`);
  console.log(`📖 Docs available at http://localhost:${config.PORT}/docs\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
