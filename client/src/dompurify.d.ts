declare module 'dompurify' {
  export interface DOMPurifyI {
    sanitize(source: string, config?: any): string;
    setConfig(config: any): void;
    clearConfig(): void;
    isValidAttribute(tag: string, attr: string, value: string): boolean;
  }

  const DOMPurify: DOMPurifyI;
  export default DOMPurify;
} 