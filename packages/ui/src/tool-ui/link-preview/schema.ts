export interface SerializableLinkPreview {
  id: string;
  href: string;
  title?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
  domain?: string | undefined;
  favicon?: string | undefined;
  ratio?: "auto" | "1:1" | "4:3" | "16:9" | "9:16" | undefined;
  fit?: "cover" | "contain" | undefined;
  locale?: string | undefined;
}
