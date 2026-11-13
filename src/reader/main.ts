import { openDraft } from './page'
import './reader.css'

// The reader page's entry point; see page.ts.
void openDraft(document.getElementById('reader')!, new URL(location.href))
