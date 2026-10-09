import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCESS_DENIED_NOTICE,
  ACCESS_NOTICES,
  SESSION_ENDED_MESSAGE,
  SIGN_IN_REFUSED_MESSAGE,
  accessMessage,
  accessNotice,
} from "@/features/access/access-messages";

/**
 * What the driver reads is written in Portuguese with its accents (MOB-18).
 *
 * "Verificando sessao...", "Voce nao tem permissao", "esta inativo": the
 * session and permission screens, the sign-in toasts and the realtime
 * "Acesso encerrado" all lost their accents, one file at a time. This reads
 * every source file the app ships — code minus comments, so string literals
 * and JSX text — and refuses the unaccented spelling of words that have no
 * unaccented form in Portuguese. Identifiers are English here, so the list
 * does not collide with them.
 */

const ROOT = resolve(__dirname, "../..");

const SOURCE_DIRS = [
  "app",
  "components",
  "features",
  "hooks",
  "providers",
  "schemas",
  "store",
  "types",
  "utils",
];

const SOURCE_FILES = ["app.json", "app.config.js"];

/**
 * Unaccented forms that are never correct Portuguese. Ambiguous ones ("esta",
 * "e", "a", "so", "ja", "ate") are left to the phrases below.
 */
const UNACCENTED_WORDS = [
  "acao", "acoes", "alteracao", "apos", "atencao", "atualizacao",
  "autenticacao", "codigo", "codigos", "combustivel", "concluida",
  "concluido", "configuracao", "configuracoes", "conexao", "conexoes",
  "conteudo", "descricao", "disponivel", "distancia", "endereco", "entao",
  "excluida", "excluido", "faca", "historico", "impossivel", "indisponivel",
  "informacao", "informacoes", "invalida", "invalidas", "invalido",
  "invalidos", "localizacao", "manutencao", "midia", "necessaria",
  "necessario", "nao", "notificacao", "notificacoes", "obrigatoria",
  "obrigatorio", "ocorrencia", "ocorrencias", "odometro", "operacao",
  "opcao", "opcoes", "pagina", "periodo", "permissao", "permissoes",
  "possivel", "proxima", "proximo", "renovacao", "requisicao",
  "responsavel", "servico", "servicos", "sessao", "sessoes", "solicitacao",
  "tambem", "titulo", "usuario", "usuarios", "validacao", "veiculo",
  "veiculos", "verificacao", "versao", "voce", "voces",
];

/** "está" written "esta": only where the verb is the one possible reading. */
const UNACCENTED_PHRASES = [
  /\besta (inativ|ativ|desativad|bloquead|autorizad|disponível|indisponível|expirad|em andamento)/i,
];

const WORD = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${UNACCENTED_WORDS.join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return listFiles(path);

    return /\.(tsx?|js|json)$/.test(name) ? [path] : [];
  });
}

/**
 * The source with its comments blanked, line breaks kept (so line numbers
 * still point at the file). Strings are walked, not guessed: a `//` inside
 * "https://…" is not a comment.
 */
function withoutComments(source: string): string {
  let out = "";
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      out += char;

      if (char === "\\") {
        out += next ?? "";
        index += 1;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;

      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop - 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") quote = char;

    out += char;
  }

  return out;
}

function unaccentedIn(file: string): string[] {
  const text = withoutComments(readFileSync(file, "utf8"));
  const where = relative(ROOT, file).replace(/\\/g, "/");

  return text.split("\n").flatMap((line, index) => {
    const found = [...line.matchAll(WORD)].map((match) => match[1]);

    for (const phrase of UNACCENTED_PHRASES) {
      const match = line.match(phrase);
      if (match) found.push(match[0]);
    }

    return found.map((word) => `${where}:${index + 1} "${word}"`);
  });
}

describe("the app's Portuguese", () => {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => listFiles(join(ROOT, dir))),
    ...SOURCE_FILES.map((file) => join(ROOT, file)),
  ];

  it("reads every source file the app ships", () => {
    // A moved folder must not turn this into a check of nothing.
    expect(files.length).toBeGreaterThan(200);
  });

  it("keeps its accents in every string the driver can read", () => {
    expect(files.flatMap(unaccentedIn)).toEqual([]);
  });

  it("catches what it is meant to catch (the scan itself)", () => {
    const probe = withoutComments(
      [
        '// Voce nao sabe: a comment is not UI',
        'const a = "Verificando sessao...";',
        "<Text>Seu cadastro esta inativo</Text>",
        'const url = "https://nao-e-comentario.example";',
      ].join("\n"),
    );

    const lines = probe.split("\n");

    expect([...lines[0].matchAll(WORD)]).toHaveLength(0);
    expect([...lines[1].matchAll(WORD)].map((m) => m[1])).toEqual(["sessao"]);
    expect(lines[2]).toMatch(UNACCENTED_PHRASES[0]);
    expect([...lines[3].matchAll(WORD)].map((m) => m[1])).toEqual(["nao"]);
  });
});

describe("the access messages", () => {
  it("say each reason the same way on every screen, with accents", () => {
    expect(accessNotice("driver_inactive").message).toBe(
      "Seu cadastro como motorista está inativo. Entre em contato com o administrador.",
    );
    expect(accessMessage("access_denied", SESSION_ENDED_MESSAGE)).toBe(
      "Sua conta foi excluída ou não está autorizada.",
    );
    expect(accessMessage("session_expired", SIGN_IN_REFUSED_MESSAGE)).toBe(
      "Sua sessão expirou. Faça login novamente.",
    );
  });

  it("fall back per screen for a reason this build does not know", () => {
    expect(accessNotice("algo_novo")).toEqual(ACCESS_DENIED_NOTICE);
    expect(accessMessage("algo_novo", SESSION_ENDED_MESSAGE)).toBe(
      "Sua sessão foi encerrada. Faça login novamente.",
    );

    // The reason comes from the server: Object's own keys are not reasons.
    expect(accessNotice("constructor")).toEqual(ACCESS_DENIED_NOTICE);
    expect(accessMessage("toString", SIGN_IN_REFUSED_MESSAGE)).toBe(
      SIGN_IN_REFUSED_MESSAGE,
    );
  });

  it("no longer carry the reason the API stopped sending (CRIT-20)", () => {
    expect(Object.keys(ACCESS_NOTICES)).not.toContain("no_vehicle_permission");
  });
});
