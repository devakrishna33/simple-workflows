# simple-workflows

Why must every implementation of a durable workflow be a service? Can't we just have a simple SDK that utilizes existing infrastructure like Redis or PostgreSQL, which is most likely already being used in the application?

This is a work in progress. The goal is to provide a simple way to define and run durable workflows in typescript using common infrastructure which you might already be using. This will never be released as a service, but we will try to take you to the point where you can afford other services.

Existing solutions like,
1. [Temporal](https://temporal.io/) is great, but it's costly, has a steep learning curve and self hosting is not easy.
2. [Inggest](https://www.inngest.com/) is great, but it's costly and no way to self host right now (as of April 2024). If going by the trend most likely it won't be easy to self host when they do release it.
3. [Trigger](https://trigger.dev/) is great, and one of the solutions which is easy to self host and easy to write, but with their changes in v3 it does not seem easy to self host.

