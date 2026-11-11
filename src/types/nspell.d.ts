// nspell nao traz tipos proprios; declaracao minima do que usamos.
declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
  }
  type Dicionario = { aff: string | Buffer; dic: string | Buffer };
  function nspell(dictionary: Dicionario | Array<Dicionario>): NSpell;
  function nspell(aff: string | Buffer, dic: string | Buffer): NSpell;
  export default nspell;
}
