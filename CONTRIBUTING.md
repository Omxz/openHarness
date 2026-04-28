# Contributing

OpenHarness is early. The best contributions right now are small, tested changes that make the core loop more reliable.

## Development

```bash
npm test
npm run demo
```

Please keep provider, tool, policy, verifier, and kernel responsibilities separate. New behavior should include tests using Node's built-in test runner.
