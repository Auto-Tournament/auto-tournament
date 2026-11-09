# Issue templates

GitHub issue forms for Auto Tournament 3. They cover the whole stack: the
site, CS2 Server Manager (`csm`) and Ready Up. Blank issues are off, so
everyone picks a form.

| Form                | File                           | Label          |
| ------------------- | ------------------------------ | -------------- |
| Bug report          | `bug_report.yml`               | 🐞 bug         |
| Server setup help   | `server_help.yml`              | 🆘 need help   |
| Feature request     | `feature_request.yml`          | ➕ new feature |
| Question            | `question.yml`                 | none           |
| Performance problem | `performance_issue.yml`        | 🐞 bug         |
| Community request   | `community_request.yml`        | 🆘 need help   |
| Translation         | `translation_contribution.yml` | none           |

`config.yml` adds the links in the chooser: the docs, Discord, the docs
repository (for wrong pages), csm's and Ready Up's own repositories (for
using them without the site), and private security reports.

## Editing

- A label in `labels:` must already exist in the repository, with its emoji.
  GitHub skips labels it doesn't know.
- Ask for the versions the way users can find them: Auto Tournament on the
  admin home page, csm and Ready Up on the machine on the Servers page, CS2
  with `version` in the server console.
- Point at the diagnostics the docs use: `csm doctor`, `csm logs <n>`,
  `ru selftest`, `docker logs auto-tournament`.
- Check a change on GitHub: Issues → New issue, after it is merged.

Syntax: [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms).
