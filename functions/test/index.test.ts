describe('Cloud Functions exports', () => {
  const functions = require('../src/index');

  it('exports the scheduled PurpleAir poller', () => {
    expect(functions.pollPurpleAir).toBeDefined();
  });

  it('exports the BreatheAI chat proxy and health check', () => {
    expect(functions.llama3Chat).toBeDefined();
    expect(functions.healthCheck).toBeDefined();
  });
});
