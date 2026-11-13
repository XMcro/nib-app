/** Code's colours on an exported page, an e-book or in Word, where the paper is always white: each reads at 4.5:1 on the grey behind a block of code. */
export const CODE_INK: Record<string, string> = { comment: '6a6f7a', keyword: '6d3fd4', string: '1f7a3a', number: 'a05600', name: '1f6fb8' }
export const CODE_CSS = Object.entries(CODE_INK).map(([colour, ink]) => `.nib-code-${colour} { color: #${ink}; }`).join('\n')

/** The ones a code block's menu gives in words, each as a Markdown fence would name it. All of them load together (refractor's common set). */
export const COMMON_LANGUAGES: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  graphql: 'GraphQL',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  less: 'Less',
  lua: 'Lua',
  makefile: 'Makefile',
  markdown: 'Markdown',
  objectivec: 'Objective-C',
  perl: 'Perl',
  php: 'PHP',
  python: 'Python',
  r: 'R',
  ruby: 'Ruby',
  rust: 'Rust',
  sass: 'Sass',
  scss: 'SCSS',
  bash: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
}

/** Every other language there's a grammar for, by the name it goes by. */
export const MORE_LANGUAGES = (
  'abap abnf actionscript ada agda al antlr4 apacheconf apex apl applescript aql arduino arff armasm arturo asciidoc asm6502 asmatmel aspnet autohotkey autoit avisynth avro-idl awk ' +
  'basic batch bbcode bbj bicep birb bison bnf bqn brainfuck brightscript bro bsl cfscript chaiscript cil cilkc cilkcpp clike clojure cmake cobol coffeescript concurnas cooklang coq ' +
  'crystal cshtml csp csv cue cypher d dart dataweave dax dhall django dns-zone-file docker dot ebnf editorconfig eiffel ejs elixir elm erb erlang etlua excel-formula factor ' +
  'false firestore-security-rules flow fortran fsharp ftl gap gcode gdscript gedcom gettext gherkin git glsl gml gn go-module gradle groovy haml handlebars haskell haxe hcl hlsl hoon ' +
  'hpkp hsts http ichigojam icon icu-message-format idris iecst ignore inform7 ini io j javadoc javadoclike javastacktrace jexl jolie jq jsdoc json5 jsonp ' +
  'jsstacktrace jsx julia keepalived keyman kumir kusto latex latte lilypond linker-script liquid lisp livescript llvm log lolcode magma markup-templating markup mata matlab maxscript ' +
  'mel mermaid metafont mizar mongodb monkey moonscript n1ql n4js nand2tetris-hdl naniscript nasm neon nevod nginx nim nix nsis ocaml odin opencl openqasm oz parigp parser pascal ' +
  'pascaligo pcaxis peoplecode phpdoc plant-uml plsql powerquery powershell processing prolog promql properties protobuf psl pug puppet pure purebasic purescript q qml qore ' +
  'qsharp racket reason regex rego renpy rescript rest rip roboconf robotframework sas scala scheme shell-session smali smalltalk smarty sml solidity solution-file soy sparql splunk-spl ' +
  'sqf squirrel stan stata stylus supercollider systemd t4-cs t4-templating t4-vb tap tcl textile toml tremor tsx tt2 turtle twig typoscript unrealscript uorazor uri v vala vbnet ' +
  'velocity verilog vhdl vim visual-basic warpscript wasm web-idl wgsl wiki wolfram wren xeora xojo xquery yang zig'
).split(' ')
