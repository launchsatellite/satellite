import { languages } from "monaco-editor/editor/editor.api";

interface MonarchModule {
  language: languages.IMonarchLanguage;
  conf?: languages.LanguageConfiguration;
}

const ownLanguages = [
  { id: "typescriptreact", extension: ".tsx", base: "typescript", alias: "TypeScript JSX" },
  { id: "javascriptreact", extension: ".jsx", base: "javascript", alias: "JavaScript JSX" },
];

function isMonarchModule(value: unknown): value is MonarchModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "language" in value &&
    typeof value.language === "object" &&
    value.language !== null
  );
}

function hasLoader(value: object): value is { loader: () => Promise<unknown> } {
  return "loader" in value && typeof value.loader === "function";
}

function loaderOf(language: string): (() => Promise<unknown>) | undefined {
  const known = languages.getLanguages().find(({ id }) => id === language);
  return known !== undefined && hasLoader(known) ? known.loader : undefined;
}

export async function monarchModule(language: string): Promise<MonarchModule | undefined> {
  const loaded = await loaderOf(language)?.();
  return isMonarchModule(loaded) ? loaded : undefined;
}

function registerOwnLanguages(): void {
  for (const { id, extension, base, alias } of ownLanguages) {
    const loader = loaderOf(base);
    if (loader === undefined || languages.getLanguages().some((known) => known.id === id)) {
      continue;
    }
    const definition = { id, extensions: [extension], aliases: [alias], loader };
    languages.register(definition);
    languages.registerTokensProviderFactory(id, {
      create: async () => (await monarchModule(id))?.language ?? null,
    });
    languages.onLanguageEncountered(id, () => {
      void monarchModule(id).then((loaded) => {
        if (loaded?.conf !== undefined) languages.setLanguageConfiguration(id, loaded.conf);
      });
    });
  }
}

export function diffLanguage(path: string): string {
  registerOwnLanguages();
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? undefined : name.slice(dot).toLowerCase();
  const known = languages.getLanguages();
  const own = ownLanguages.find((language) => language.extension === extension);
  if (own !== undefined && known.some(({ id }) => id === own.id)) return own.id;
  const found = known.find(
    (language) =>
      language.filenames?.includes(name) === true ||
      (extension !== undefined && language.extensions?.includes(extension) === true),
  );
  return found?.id ?? "plaintext";
}
