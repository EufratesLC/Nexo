// Remove segredos de textos que vão para logs ou respostas: ligações à base, tokens,
// credenciais de dispositivo e palavras-passe em pares chave=valor.

const PADROES: [RegExp, string][] = [
  // postgresql://utilizador:senha@servidor/base → postgresql://<omitido>@servidor/base
  [/\b(postgres(?:ql)?):\/\/[^\s@/]*@/gi, '$1://<omitido>@'],
  // Cabeçalhos de autorização: Bearer <jwt>, Nexo-Dispositivo <segredo>
  [/\b(Bearer|Nexo-Dispositivo)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <omitido>'],
  // JWT soltos (três partes base64url)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt omitido>'],
  // Credenciais de dispositivo (prefixo nd_)
  [/\bnd_[A-Za-z0-9_-]{8,}\b/g, '<credencial omitida>'],
  // password=..., senha: ..., secret=..., token=...
  [/\b(password|passwd|pwd|senha|secret|segredo|token|apikey|api_key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1$2<omitido>'],
]

export function sanitizar(texto: string): string {
  let r = texto
  for (const [padrao, substituto] of PADROES) r = r.replace(padrao, substituto)
  return r
}

/** Caminhos que o logger apaga dos objectos registados (formato do pino). */
export const CAMINHOS_REDIGIDOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-nexo-credencial"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.senha',
  '*.token',
  '*.credencial',
  '*.connectionString',
  '*.ligacao',
]
