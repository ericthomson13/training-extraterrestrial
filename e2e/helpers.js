// A minimal, always-valid program document for e2e setup -- mirrors
// test/programValidator.test.js's base() so both suites agree on what
// "valid" looks like. Callers spread/override fields as needed.
export function minimalProgram(overrides = {}) {
  return {
    displayName: "E2E Test Program",
    units: "lb",
    startDate: "2027-01-04",
    periods: [{ n: 1, phase: "Intro", lengthDays: 7 }],
    testDefinitions: [{ key: "squat", label: "Back squat", unit: "lb x reps", kind: "load-reps-e1rm" }],
    videos: {},
    circuits: {},
    activation: {},
    warmupTemplates: [],
    sessionTemplates: [
      {
        key: "A",
        title: "Day A",
        scope: { type: "period", n: 1 },
        items: [{ name: "Back squat", rx: "3x5" }],
      },
    ],
    ...overrides,
  };
}

// Creates a program via the API and activates it in one call, the way setup
// for "a user with an active program" needs to for most UI tests -- skips
// driving the upload form when the form itself isn't what's under test.
export async function createAndActivateProgram(request, userEmail, { name = "E2E Program", sport = null, content = minimalProgram() } = {}) {
  const createRes = await request.post("/api/programs", {
    headers: { "X-Test-User-Email": userEmail },
    data: { name, sport, content },
  });
  if (!createRes.ok()) {
    throw new Error(`createAndActivateProgram: create failed ${createRes.status()}: ${await createRes.text()}`);
  }
  const { programId } = await createRes.json();
  const activateRes = await request.post(`/api/programs/${programId}/activate`, {
    headers: { "X-Test-User-Email": userEmail },
  });
  if (!activateRes.ok()) {
    throw new Error(`createAndActivateProgram: activate failed ${activateRes.status()}: ${await activateRes.text()}`);
  }
  return programId;
}
