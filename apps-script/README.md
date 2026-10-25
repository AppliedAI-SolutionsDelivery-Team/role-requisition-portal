# Connecting the approval matrix to the Google Sheet

The Google Sheet "Approval Matrix - Level x Department" stays the source of truth. The portal reads it live, and HR admins can edit it from the portal's Approval matrix page. Every change is written back to the sheet and logged.

HR can still edit the sheet directly. The portal picks those edits up on the next load. If someone edits the sheet while an admin is editing in the portal, the portal blocks the publish and asks the admin to load the latest version first, so nothing gets overwritten.

## One-time setup (about 15 minutes)

### 1. Add the script to the sheet
1. Open the sheet, then go to **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with the `Code.gs` file in this folder, then save.
3. In the function dropdown pick `setup` and click **Run**. Approve the permissions prompt.
   This creates two new tabs: **Portal Admins** and **Matrix Change Log**. It also checks that the grid parses (see the execution log).

### 2. Choose who can edit
In the **Portal Admins** tab, put one email per row in column A, starting at row 2. For example:
- kylee.hutchings@aaico.com
- Nick's and Farah's @aaico.com addresses

Anyone signed in who is not on this list can view the matrix but cannot edit it.

### 3. Create the Google sign-in client
1. Go to Google Cloud Console > **APIs & Services > Credentials** (any project owned by AppliedAI).
2. **Create credentials > OAuth client ID**. Application type: **Web application**.
3. Under **Authorised JavaScript origins**, add the portal URL, for example `https://role-requisition-portal.vercel.app`.
4. Copy the **Client ID**.
5. If the consent screen asks for a user type, choose **Internal** so only @aaico.com accounts can sign in.

### 4. Tell the script the client ID
In Apps Script go to **Project Settings > Script properties** and add:

| Property | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 3 |
| `ALLOWED_DOMAIN` | `aaico.com` (optional, this is the default) |

### 5. Deploy the script as a web app
1. Click **Deploy > New deployment**, then choose type **Web app**.
2. **Execute as:** Me. **Who has access:** Anyone.
   This is safe because writes are only accepted with a verified Google sign-in from an address on the Portal Admins tab. Reads return only the matrix.
3. Copy the **Web app URL**. It ends in `/exec`.

After any later change to `Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the URL stays the same.

### 6. Point the portal at it
In `index.html`, find the `CONFIG` block near the top of the script and fill in the two values:

```js
SHEET_API_URL:"https://script.google.com/macros/s/XXXX/exec",
GOOGLE_CLIENT_ID:"XXXX.apps.googleusercontent.com",
```

Push to `main`. The Vercel workflow redeploys automatically.

## How it behaves

- **Everyone:** the Raise a role form and the approval route always use the live sheet.
- **HR admins:** click **Sign in with Google**, then **Edit matrix**. From there they can:
  - change any cell's approvers and their order
  - apply one chain to several levels or departments at once
  - add, rename, reorder or delete departments and levels
- **Before publishing:**
  - Data problems block publishing and are listed at the top: an empty cell, a non-@aaico.com address, or the same person twice in one chain.
  - **Review and publish** shows every change before it is written.
- **Audit:** each publish adds a row to **Matrix Change Log** with who made the change, when, and what changed. The portal shows the last 10 entries.
- **Requests already in approval:** they keep the route they were submitted with. Only new requests use the updated matrix.

## Sheet layout the script expects

- One row whose first cell is `Level`. That is the header row.
- To the right of `Level`: `Level title` and `Track`, then one column per department.
- Below the header: one row per level, with approver emails in each cell in approval order. They can be separated by spaces, commas or new lines. The portal writes them one per line.
- The grid ends at the first empty row and the first empty header cell. Anything below or to the right is left alone. Adding levels from the portal writes into the rows directly below the grid, so keep at least a few empty rows under it.
