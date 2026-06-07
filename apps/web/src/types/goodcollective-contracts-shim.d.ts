// @gooddollar/goodcollective-contracts ships raw .ts files as its type entry
// point, which conflicts with verbatimModuleSyntax. This shim satisfies
// TypeScript's module resolution without re-compiling the broken source files.
declare module '@gooddollar/goodcollective-contracts/typechain-types' {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module '@gooddollar/goodcollective-contracts/typechain-types/*' { const x: any; export = x }
declare module '@gooddollar/goodcollective-contracts/releases/*' { const x: any; export default x }
