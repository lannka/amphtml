/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const {
  staticTemplateFactories,
  staticTemplateTags,
  staticTemplateFactoryFns,
} = require('../babel-plugins/static-template-metadata');

/**
 * @param {*} context
 * @return {{
 *   CallExpression: {Function(node: CompilerNode): void}
 *   TaggedTemplateExpression: {Function(node: CompilerNode): void}
 * }}
 */
module.exports = function (context) {
  /**
   * @param {CompilerNode} node
   * @return {void}
   */
  function tagCannotBeCalled(node) {
    const {name} = node.callee;
    context.report({
      node,
      message:
        `The ${name} helper MUST NOT be called directly. ` +
        'Instead, use it as a template literal tag: ``` ' +
        name +
        '`<div />` ```',
    });
  }

  /**
   * @param {CompilerNode} node
   * @return {void}
   */
  function factoryUsage(node) {
    const {parent} = node;
    const {name} = node.callee;

    const expectedTagName = staticTemplateFactories[name];

    if (parent.type === 'TaggedTemplateExpression' && parent.tag === node) {
      return tagUsage(parent, `${name}()`);
    }

    if (
      parent.type === 'VariableDeclarator' &&
      parent.init === node &&
      parent.id.type === 'Identifier' &&
      parent.id.name === expectedTagName
    ) {
      return;
    }

    if (
      parent.type === 'AssignmentExpression' &&
      parent.right === node &&
      parent.left.type === 'Identifier' &&
      parent.left.name === expectedTagName
    ) {
      return;
    }

    context.report({
      node,
      message:
        `${name} result must be stored into a variable named ` +
        `"${expectedTagName}", or used as the tag of a tagged template ` +
        'literal.',
    });
  }

  /**
   * @param {CompilerNode} node
   * @param {string} opt_name
   * @return {void}
   */
  function tagUsage(node, opt_name) {
    const {quasi, tag} = node;
    if (quasi.expressions.length !== 0) {
      context.report({
        node,
        message:
          `The ${opt_name || tag.name} template tag CANNOT accept expression.` +
          ' The template MUST be static only.',
      });
    }

    const template = quasi.quasis[0];
    const string = template.value.cooked;
    if (!string) {
      context.report({
        node: template,
        message: 'Illegal escape sequence detected in template literal.',
      });
    }

    if (/<(html|body|head)/i.test(string)) {
      context.report({
        node: template,
        message:
          'It it not possible to generate HTML, BODY, or' +
          ' HEAD root elements. Please do so manually with' +
          ' document.createElement.',
      });
    }

    const invalids = invalidVoidTag(string);
    if (invalids.length) {
      const sourceCode = context.getSourceCode();
      const {start} = template;

      for (let i = 0; i < invalids.length; i++) {
        const {tag, offset} = invalids[i];
        context.report({
          node: template,
          loc: sourceCode.getLocFromIndex(start + offset),
          message: `Invalid void tag "${tag}"`,
        });
      }
    }
  }

  /**
   * @param {*} string
   * @return {{
   *   tag: string,
   *   offset: number,
   * }[]}
   */
  function invalidVoidTag(string) {
    // Void tags are defined at
    // https://html.spec.whatwg.org/multipage/syntax.html#void-elements
    const invalid = /<(?!area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)([a-zA-Z-]+)( [^>]*)?\/>/g;
    const matches = [];

    let match;
    while ((match = invalid.exec(string))) {
      matches.push({
        tag: match[1],
        offset: match.index,
      });
    }

    return matches;
  }

  return {
    CallExpression(node) {
      if (/test-/.test(context.getFilename())) {
        return;
      }

      const {callee} = node;
      if (callee.type !== 'Identifier') {
        return;
      }

      if (staticTemplateTags.has(callee.name)) {
        return tagCannotBeCalled(node);
      }
      if (staticTemplateFactoryFns.has(callee.name)) {
        return factoryUsage(node);
      }
    },

    TaggedTemplateExpression(node) {
      const {tag} = node;
      if (tag.type !== 'Identifier' || !staticTemplateTags.has(tag.name)) {
        return;
      }

      tagUsage(node);
    },
  };
};
