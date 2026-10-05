export function createSubmissionGate() {
  let pending=false;
  return async (submit: () => Promise<void>) => {
    if(pending)return;
    pending=true;
    try { await submit(); } finally { pending=false; }
  };
}
