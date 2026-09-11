import { test } from "node:test";
import assert from "node:assert/strict";

import { hostnameMatchesSite, hostnameOf } from "./hostname.js";

test("hostnameOf reads absolute URLs and returns null for anything else", () => {
  assert.equal(hostnameOf("https://WWW.Example.com/path?q=1"), "www.example.com");
  assert.equal(hostnameOf("/relative"), null);
  assert.equal(hostnameOf(""), null);
  assert.equal(hostnameOf(undefined), null);
});

test("the site's domain, its subdomains and local hosts match; other sites do not", () => {
  assert.equal(hostnameMatchesSite("example.com", "example.com"), true);
  assert.equal(hostnameMatchesSite("www.example.com", "example.com"), true);
  assert.equal(hostnameMatchesSite("example.com", "www.example.com"), true);
  assert.equal(hostnameMatchesSite("blog.example.com", "example.com"), true);
  assert.equal(hostnameMatchesSite("localhost", "example.com"), true);
  assert.equal(hostnameMatchesSite("127.0.0.1", "example.com"), true);
  assert.equal(hostnameMatchesSite("evil.com", "example.com"), false);
  assert.equal(hostnameMatchesSite("notexample.com", "example.com"), false);
  assert.equal(hostnameMatchesSite("example.com.evil.net", "example.com"), false);
});
