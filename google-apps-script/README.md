# Form mailer — Google Apps Script

The website has four forms: loan application, job application, complaint, and contact. Each one POSTs to this script. The script emails the submission to a Gmail inbox and sends a reference number back to the page. Nothing is stored anywhere: there's no spreadsheet, no Drive file, and no field values in the logs.

The data travels from the visitor's browser to Google and then into the Gmail inbox. No third-party form service is involved.

## One-time setup (about 10 minutes)

1. **Sign in to the Gmail account that should receive the forms.** Turn on 2-step verification for it. These emails contain national ID numbers, dates of birth and income details.
2. Go to <https://script.new>. Name the project `Nova Credit form mailer`.
3. Delete the sample code, paste in the whole of [`Code.gs`](Code.gs), and save.
4. Select **`testSend`** in the function dropdown, then click **Run**. Google asks for permission to send email as you: click **Review permissions**, choose the account, then **Advanced → Go to project → Allow**. A test email should arrive in the inbox.
5. **Deploy → New deployment → Select type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**, then copy the **Web app URL**. It ends in `/exec`.
6. In `Nova Credit.dc.html`, paste that URL into the constant near the top of the page script:
   ```js
   const FORM_ENDPOINT = 'https://script.google.com/macros/s/…/exec';
   ```
   Commit and push. Vercel redeploys automatically.

Until step 6 is done, submitting a form shows "Sending failed". Nothing is lost silently, and the visitor is shown the phone number instead.

## Sending forms to different inboxes (optional)

By default every form goes to the Gmail account that owns the script. To route them separately, go to **Project Settings → Script properties** and add any of these:

| Property | Form |
|---|---|
| `TO_LOAN` | Loan application |
| `TO_HR` | Job application |
| `TO_COMPLAINTS` | Complaint |
| `TO_CONTACT` | Contact |
| `TO` | Fallback for any form without its own property |

The addresses are kept here rather than in the code. The GitHub repo is public, and this keeps the addresses out of it.

## Changing the script later

After editing `Code.gs` in the Apps Script editor, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same. If you create a new deployment instead, you get a new URL, and you'd have to update `FORM_ENDPOINT`.

## Limits and protections

- **Gmail quota:** a free Gmail account can send about 100 emails a day through Apps Script. The script also stops at 30 per hour, so a flood of spam can't use up the day's quota. A Google Workspace account allows 1,500 a day.
- **Checks on every submission:** only known fields are accepted, required fields must be present, and the email address must be valid. Submissions completed in under 3 seconds are rejected as bots.
- **Attachments:** pdf, jpg or png only, up to 10 MB. The file type is checked from the file's actual bytes, not the name the browser reports.
- **Subject lines** contain the surname, first name and reference only. The personal ID number appears only in the email body.
- **The URL is public.** Anyone can post to it, but the only thing it does is email your own inbox, with the limits above.

For a lender, a Google Workspace mailbox is the better home for this data than a personal @gmail.com account: Workspace comes with a data-processing agreement and admin controls.
