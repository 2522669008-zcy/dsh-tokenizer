// dsh-tokenizer — host half.
//
// Serves exact DeepSeek token counts for the composer draft over a tiny local route:
//
//   POST /dsh-tokenizer/count   { "text": "你好，世界" }
//     -> { "ok": true, "value": { "tokens": 3, "chars": 5 } }
//
// The vocabulary ships inside this package under assets/ (official tokenizer.json +
// tokenizer_config.json), so the plugin works offline and needs no download, no Python
// and no transformers install. A deployment that wants another vocabulary can point
// `tokenizerPath` at any tokenizer.json; its tokenizer_config.json is read from the same
// directory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tokenizer } from '@huggingface/tokenizers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Cordis plugin name — must match the name in cordis.patch.yml. */
export const name = 'dsh-tokenizer';

/** Services required by this plugin. */
export const inject = ['webServer'];

/** Bundled official vocabulary, resolved relative to the package (not to a user path). */
const BUNDLED_TOKENIZER = path.join(__dirname, '..', 'assets', 'tokenizer.json');

/** Max JSON request body size — a draft, not a document. */
const MAX_BODY_BYTES = 256 * 1024;

async function readJsonBody(req, cap) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > cap) return null;
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(res, envelope, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(envelope));
}

export function apply(ctx, config = {}) {
  const tokenizerPath = config.tokenizerPath ? path.resolve(config.tokenizerPath) : BUNDLED_TOKENIZER;
  const tokenizerConfigPath = path.join(path.dirname(tokenizerPath), 'tokenizer_config.json');

  for (const file of [tokenizerPath, tokenizerConfigPath]) {
    if (!fs.existsSync(file)) {
      // Loud and specific: a missing vocabulary is a deployment problem, not a runtime one.
      throw new Error(`[dsh-tokenizer] vocabulary file not found: ${file}`);
    }
  }

  const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf8'));
  const tokenizerConfig = JSON.parse(fs.readFileSync(tokenizerConfigPath, 'utf8'));
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);

  ctx.logger?.info(`[dsh-tokenizer] loaded vocabulary from ${tokenizerPath}`);

  const webserver = ctx.get('webServer');
  if (!webserver) {
    ctx.logger?.warn('[dsh-tokenizer] webServer unavailable; tokenizer UI will not work');
    return;
  }

  // The route must be owned by this fiber: `register` returns a disposer, and dropping it
  // leaks the route past unload — a later reload then dies on "duplicate prefix route".
  ctx.effect(() =>
    webserver.register({
      kind: 'prefix',
      path: '/dsh-tokenizer',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          json(res, { ok: true, value: { service: 'dsh-tokenizer' } });
          return;
        }
        if (req.method !== 'POST') {
          json(res, { ok: false, error: { code: 'method', message: 'only GET and POST are allowed' } }, 405);
          return;
        }

        const body = await readJsonBody(req, MAX_BODY_BYTES);
        if (body === null || typeof body.text !== 'string') {
          json(res, { ok: false, error: { code: 'rejected', message: 'request body must be JSON with a string "text" field' } }, 400);
          return;
        }

        try {
          const encoded = tokenizer.encode(body.text);
          json(res, {
            ok: true,
            value: {
              tokens: encoded.ids.length,
              chars: body.text.length
            }
          });
        } catch (error) {
          json(res, {
            ok: false,
            error: { code: 'internal', message: error?.message ?? String(error) }
          }, 500);
        }
      }
    }),
  );
}
