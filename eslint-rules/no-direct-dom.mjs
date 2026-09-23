import ts from "typescript";

const restrictedDomProperties = new Set([
  "document",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "getElementsByTagNameNS",
  "getElementsByName",
  "createElementNS",
  "createTextNode",
  "createDocumentFragment",
  "innerHTML",
  "outerHTML",
  "innerText",
  "textContent",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "insertAdjacentText",
  "appendChild",
  "removeChild",
  "replaceChild",
  "replaceChildren",
  "insertBefore",
  "setAttribute",
  "removeAttribute",
  "toggleAttribute",
  "classList",
]);

// Resolve browser members through TypeScript instead of banning names on every object.
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: { dom: "Use React state, JSX, and refs instead of querying or manually modifying the DOM." },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error("no-direct-dom requires TypeScript project information.");
    }
    const checker = services.program.getTypeChecker();
    const fromDom = (symbol) => symbol?.declarations?.some((declaration) =>
      /[/\\]typescript[/\\]lib[/\\]lib\.dom(?:\.iterable)?\.d\.ts$/.test(declaration.getSourceFile().fileName));
    function check(node, receiver, name) {
      if (!restrictedDomProperties.has(name)) return;
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(receiver));
      const types = type.isUnionOrIntersection() ? type.types : [type];
      if (types.some((part) => fromDom(checker.getPropertyOfType(checker.getNonNullableType(part), name)))) {
        context.report({ node, messageId: "dom" });
      }
    }
    function propertyName(node, computed) {
      if (!computed && node.type === "Identifier") return node.name;
      if (node.type === "Literal") return String(node.value);
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
      return type.flags & ts.TypeFlags.StringLiteral ? type.value : undefined;
    }
    return {
      MemberExpression(node) {
        check(node, node.object, propertyName(node.property, node.computed));
      },
      // Destructuring must not bypass the restriction.
      Property(node) {
        if (node.parent.type === "ObjectPattern") {
          check(node, node.parent, propertyName(node.key, node.computed));
        }
      },
    };
  },
};
