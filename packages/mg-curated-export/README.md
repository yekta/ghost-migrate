# Migrate Curated Export

Migrate content from Curated using the supplied zip file, and generate a `zip` file you can import into a Ghost installation.


## Install

To install the CLI, which is required for the Usage commands below:

```sh
npm install --global @tryghost/migrate
```

To use this package in your own project:

`npm install @tryghost/mg-curate-export --save`

or

`yarn add @tryghost/mg-curate-export`


## Usage

To run a Curated migration, the required command is:

```sh
migrate curate <path to zip file>
```

It's possible to pass more options, in order to achieve a better migration file for Ghost:

- **`-V` `--verbose`**
    - bool - default: `false`
    - Show verbose output
- **`--zip`**
    - bool - default: `true`
    - Create a zip file
- **`-s` `--scrape`**
    - string - default: `all`
    - Configure scraping tasks (choices: `all`, `web`, `img`, `none`)
- **`-u` `--url`**
    - string - default: `false`
    - Provide a URL (without trailing slash) to the hosted source site e.g. `https://mycompany.com`
- **`-e` `--email`**
    - string - default: `false`
    - Provide an email domain for users e.g. `mycompany.com`
- **`--addTags`**
    - string - default: `false`
    - Provide one or more tag names which should be added to every post in this migration
- **`--fallBackHTMLCard`**
    - bool - default: `false`
    - Fall back to convert to HTMLCard, if standard Mobiledoc convert fails

A more complex migration command could look like this:

```sh
migrate curate <path to zip file> --email example.com
```

This will process all posts from the zip file, and all authors will have an email address ending in 'example.com'


## Develop

This is a mono repository, managed with [lerna](https://lerna.js.org).

Follow the instructions for the top-level repo.
1. `git clone` this repo & `cd` into it as usual
2. Run `yarn` to install top-level dependencies.


## Run

To run a local development copy, `cd` into this directory, and use `yarn dev` instead of `migrate` like so:

```sh
yarn dev curate <path to zip file>
```


## Test

- `yarn lint` run just eslint
- `yarn test` run lint and tests


# Copyright & License

Copyright (c) 2013-2022 Ghost Foundation - Released under the [MIT license](LICENSE).
