import visit from 'unist-util-visit' // tslint:disable-line: import-name
import {
  CodeAction,
  CodeActionKind,
  CodeActionProvider,
  Diagnostic,
  DiagnosticSeverity,
  Disposable,
  Range,
  TextDocument,
  WorkspaceEdit,
  languages,
} from 'vscode'
import { parseHtml, parseMd, parseYaml } from './parser'
import { frontMatterRegex } from '../utils'

const warnDirectives = [
  // Marpit
  '$headingDivider',
  '$style',
  '$theme',

  // Marp Core
  '$size',
]

export const code = 'deprecated-dollar-prefix'

export function register(doc: TextDocument, diagnostics: Diagnostic[]) {
  let markdown = doc.getText()
  let index = 0

  const detectDirectives = (text: string, offset: number = 0) => {
    const { contents, errors } = parseYaml(text)

    if (errors.length === 0 && contents && contents['items']) {
      for (const item of contents['items']) {
        if (item.type === 'PAIR' && warnDirectives.includes(item.key.value)) {
          const name = item.key.value.slice(1)
          const [start, end] = item.key.range

          const diagnostic = new Diagnostic(
            new Range(
              doc.positionAt(start + offset),
              doc.positionAt(end + offset)
            ),
            `Dollar prefix support for ${name} global directive is deprecated. Remove "$" to fix.`,
            DiagnosticSeverity.Warning
          )

          diagnostic.source = 'marp-vscode'
          diagnostic.code = code

          diagnostics.push(diagnostic)
        }
      }
    }
  }

  // Front-matter
  const fmMatched = markdown.match(frontMatterRegex)

  if (fmMatched && fmMatched.index === 0) {
    const [, open, body, close] = fmMatched
    detectDirectives(body, open.length)

    index = open.length + body.length + close.length
    markdown = markdown.slice(index)
  }

  // HTML comments
  visit(parseMd(markdown), 'html', (n: any) =>
    visit(parseHtml(n.value), 'comment', (c: any) => {
      const trimmedLeft = c.value.replace(/^-*\s*/, '')

      detectDirectives(
        trimmedLeft.replace(/\s*-*$/, ''),
        index +
          n.position.start.offset +
          c.position.start.offset +
          4 +
          (c.value.length - trimmedLeft.length)
      )
    })
  )
}

export class RemoveDollarPrefix implements CodeActionProvider {
  static readonly providedCodeActionKinds = [CodeActionKind.QuickFix]

  readonly provideCodeActions: CodeActionProvider['provideCodeActions'] = (
    doc,
    _,
    context
  ) =>
    context.diagnostics
      .filter(d => d.source === 'marp-vscode' && d.code === code)
      .map(d => this.createCodeAction(d, doc))

  private createCodeAction(diag: Diagnostic, doc: TextDocument): CodeAction {
    const act = new CodeAction(
      'Remove dollar prefix from global directive',
      CodeActionKind.QuickFix
    )

    act.diagnostics = [diag]
    act.edit = new WorkspaceEdit()
    act.edit.delete(
      doc.uri,
      new Range(diag.range.start, diag.range.start.translate(0, 1))
    )
    // act.isPreferred = true  // TODO: Require VS Code >= v1.32

    return act
  }
}

export function subscribe(subscriptions: Disposable[]) {
  subscriptions.push(
    languages.registerCodeActionsProvider(
      'markdown',
      new RemoveDollarPrefix(),
      {
        providedCodeActionKinds: RemoveDollarPrefix.providedCodeActionKinds,
      }
    )
  )
}
