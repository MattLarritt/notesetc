declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it';
  interface ContainerOpts {
    validate?: (params: string) => boolean;
    render?: (tokens: { nesting: number }[], idx: number) => string;
    marker?: string;
  }
  const container: (md: MarkdownIt, name: string, options?: ContainerOpts) => MarkdownIt;
  export default container;
}
