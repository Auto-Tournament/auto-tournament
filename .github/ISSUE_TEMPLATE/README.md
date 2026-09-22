# Issue Templates

This directory contains GitHub Issue Forms (YAML-based templates) that provide structured, enforceable issue reporting.

## What Changed?

We've migrated from Markdown templates (`.md`) to YAML-based Issue Forms (`.yml`) to improve issue quality and reduce incomplete reports.

### Benefits of Issue Forms

✅ **Required fields** - Critical information can't be skipped  
✅ **Structured input** - Dropdowns, checkboxes, and validated fields  
✅ **Better examples** - Placeholders show users exactly what to provide  
✅ **Harder to ignore** - Form fields are visually distinct and required  
✅ **Consistent formatting** - All issues follow the same structure  

## Available Templates

### 🐛 Bug Report (`bug_report.yml`)
For reporting bugs and unexpected behavior. Includes:
- **Required:** Bug description, reproduction steps, expected/actual behavior
- **Required:** Deployment type, runtime, OS
- **Required:** Logs or screenshots
- Pre-submission checklist to reduce duplicates

### 🚀 Feature Request (`feature_request.yml`)
For suggesting new features or improvements. Includes:
- **Required:** Feature description, motivation, use case, proposed solution
- **Required:** Priority level
- Alternatives considered section
- Contribution checkboxes

### ❓ Question (`question.yml`)
For usage and configuration questions. Includes:
- **Required:** Question and context
- **Required:** Documentation checklist confirmation
- Category dropdown to help route questions
- Optional environment details

### 🖥️ CS2 Server Setup Help (`server_help.yml`)
For troubleshooting CS2 server configuration and connectivity. Includes:
- **Required:** Issue type, problem description, what you've tried
- **Required:** Server OS, MatchZy version, server logs
- Network and configuration details
- Specific to CS2/MatchZy server issues

### ⚡ Performance Issue (`performance_issue.yml`)
For reporting slow performance, lag, or resource usage problems. Includes:
- **Required:** Performance description, category, reproduction steps
- **Required:** Expected vs actual performance, environment details
- Data scale indicators
- Optional performance measurements/metrics

### 📚 Documentation Issue (`documentation_issue.yml`)
For reporting missing, incorrect, or unclear documentation. Includes:
- **Required:** Issue type, documentation location, what's wrong
- **Required:** Impact on users
- Suggestions for improvement
- Contribution offer

### 🙏 Community Request (`community_request.yml`)
For requesting community help with testing or feedback. Includes:
- **Required:** What needs testing, why community help is needed
- **Required:** Testing steps, environment requirements
- Testing type checkboxes
- Branch/PR link, deadline field

### 🧪 Playwright E2E Tests (`playwright-tests.yml`)
For tracking E2E test implementation. Includes:
- **Required:** Overview and test coverage plan
- Acceptance criteria checklist
- Technical details and configuration
- Related issues/PRs section

### 🌍 Translation Contribution (`translation_contribution.yml`)
For adding or improving translations. Includes:
- **Required:** Contribution type, language, locale code
- **Required:** Coverage checklist, native speaker status
- Terminology questions section
- Testing checklist
- MUI locale support indicator
- Help needed field

## Configuration

The `config.yml` file:
- Disables blank issues (users must choose a template)
- Provides links to documentation and Discord
- Adds a security issue reporting link

## For Maintainers

### Editing Templates

Templates use YAML syntax. Key field types:

```yaml
# Required text input
- type: input
  id: field-id
  attributes:
    label: Field Label
    placeholder: Example text
  validations:
    required: true

# Dropdown selection
- type: dropdown
  id: field-id
  attributes:
    label: Field Label
    options:
      - Option 1
      - Option 2
  validations:
    required: true

# Multi-line text area
- type: textarea
  id: field-id
  attributes:
    label: Field Label
    description: Helper text
    placeholder: Example
  validations:
    required: true

# Checkboxes
- type: checkboxes
  id: field-id
  attributes:
    label: Field Label
    options:
      - label: Checkbox 1
        required: true
      - label: Checkbox 2
        required: false

# Markdown (informational text)
- type: markdown
  attributes:
    value: |
      Your markdown content here
```

### Testing Templates

After making changes:
1. Commit and push to GitHub
2. Navigate to your repo's "Issues" tab
3. Click "New Issue"
4. Verify your form appears correctly
5. Test required field validation

### Resources

- [GitHub Issue Forms Documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
- [Issue Forms Schema Reference](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)

## Pull Request Template

A pull request template is also included at `.github/pull_request_template.md` to ensure consistent PR descriptions with:
- Description and related issues
- Type of change checkboxes
- Testing details and screenshots
- Comprehensive checklist
- Sections for breaking changes, migration guides, and security considerations

This template is automatically loaded when creating PRs.

## Migration Notes

All templates have been converted from `.md` to `.yml` format. The old Markdown templates have been deleted. If you need to reference the old templates, check git history:

```bash
git log --all --full-history -- ".github/ISSUE_TEMPLATE/*.md"
```

## Template Usage Statistics

To see which templates are used most:
1. Go to Issues tab
2. Use filters: `label:bug`, `label:performance`, `label:server-setup`, etc.
3. Analyze patterns to improve templates over time
