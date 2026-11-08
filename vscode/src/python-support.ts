import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    MarkupKind,
    Range,
    SymbolKind,
} from 'vscode-languageserver/node';
import type { ClassFieldInfo, ColumnAnchor, MarkdownBlock, SPL2Analysis, SymbolDef } from './preprocessor.js';

export const PYTHON_KEYWORDS = [
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'case',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'False',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'match',
    'None',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'True',
    'try',
    'type',
    'while',
    'with',
    'yield',
] as const;

const HARD_KEYWORDS = new Set<string>([
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'False',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'None',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'True',
    'try',
    'while',
    'with',
    'yield',
]);

export interface BuiltinSpec {
    name: string;
    kind: CompletionItemKind;
    signature: string;
    doc: string;
    returnType?: string;
}

export const PYTHON_BUILTINS: readonly BuiltinSpec[] = [
    // Built-in functions
    {
        name: 'print',
        kind: CompletionItemKind.Function,
        signature: "print(*values: object, sep: str = ' ', end: str = '\\n', file: Any = None, flush: bool = False) -> None",
        doc: 'Prints the values to a stream, or to `sys.stdout` by default.',
        returnType: 'None',
    },
    {
        name: 'len',
        kind: CompletionItemKind.Function,
        signature: 'len(obj: Sized) -> int',
        doc: 'Return the number of items in a container.',
        returnType: 'int',
    },
    {
        name: 'range',
        kind: CompletionItemKind.Class,
        signature: 'range(stop: int) | range(start: int, stop: int, step: int = 1)',
        doc: 'Return an immutable sequence of numbers from `start` (inclusive) to `stop` (exclusive).',
        returnType: 'list[int]',
    },
    {
        name: 'enumerate',
        kind: CompletionItemKind.Function,
        signature: 'enumerate(iterable: Iterable[T], start: int = 0) -> Iterator[tuple[int, T]]',
        doc: 'Yield pairs `(index, item)` from an iterable starting at `start`.',
    },
    {
        name: 'zip',
        kind: CompletionItemKind.Function,
        signature: 'zip(*iterables: Iterable, strict: bool = False) -> Iterator[tuple]',
        doc: 'Iterate over several iterables in parallel, producing tuples with an item from each one.',
    },
    {
        name: 'map',
        kind: CompletionItemKind.Function,
        signature: 'map(func: Callable, *iterables: Iterable) -> Iterator',
        doc: 'Return an iterator that applies `func` to every item of `iterable`.',
    },
    {
        name: 'filter',
        kind: CompletionItemKind.Function,
        signature: 'filter(function: Callable | None, iterable: Iterable[T]) -> Iterator[T]',
        doc: 'Construct an iterator from those elements of `iterable` for which `function` is true.',
    },
    {
        name: 'sorted',
        kind: CompletionItemKind.Function,
        signature: 'sorted(iterable: Iterable[T], *, key: Callable | None = None, reverse: bool = False) -> list[T]',
        doc: 'Return a new sorted list from the items in `iterable`.',
        returnType: 'list',
    },
    {
        name: 'reversed',
        kind: CompletionItemKind.Function,
        signature: 'reversed(seq: Reversible[T]) -> Iterator[T]',
        doc: 'Return a reverse iterator over the values of the given sequence.',
    },
    {
        name: 'min',
        kind: CompletionItemKind.Function,
        signature: 'min(iterable: Iterable[T], *, key: Callable | None = None, default: T = ...) -> T',
        doc: 'Return the smallest item in an iterable or the smallest of two or more arguments.',
    },
    {
        name: 'max',
        kind: CompletionItemKind.Function,
        signature: 'max(iterable: Iterable[T], *, key: Callable | None = None, default: T = ...) -> T',
        doc: 'Return the largest item in an iterable or the largest of two or more arguments.',
    },
    {
        name: 'sum',
        kind: CompletionItemKind.Function,
        signature: 'sum(iterable: Iterable[int | float], start: int | float = 0) -> int | float',
        doc: 'Sums `start` and the items of an `iterable` from left to right and returns the total.',
        returnType: 'int',
    },
    {
        name: 'abs',
        kind: CompletionItemKind.Function,
        signature: 'abs(x: int | float) -> int | float',
        doc: 'Return the absolute value of a number.',
    },
    {
        name: 'round',
        kind: CompletionItemKind.Function,
        signature: 'round(number: float, ndigits: int | None = None) -> int | float',
        doc: 'Round a number to a given precision in decimal digits.',
    },
    {
        name: 'pow',
        kind: CompletionItemKind.Function,
        signature: 'pow(base: int | float, exp: int | float, mod: int | None = None) -> int | float',
        doc: 'Equivalent to `base**exp` with 2 arguments or `(base**exp) % mod` with 3 arguments.',
    },
    {
        name: 'divmod',
        kind: CompletionItemKind.Function,
        signature: 'divmod(a: int | float, b: int | float) -> tuple[int | float, int | float]',
        doc: 'Return the tuple `(a // b, a % b)`.',
    },
    {
        name: 'all',
        kind: CompletionItemKind.Function,
        signature: 'all(iterable: Iterable[object]) -> bool',
        doc: 'Return `True` if bool(x) is True for all values x in the iterable.',
        returnType: 'bool',
    },
    {
        name: 'any',
        kind: CompletionItemKind.Function,
        signature: 'any(iterable: Iterable[object]) -> bool',
        doc: 'Return `True` if bool(x) is True for any x in the iterable.',
        returnType: 'bool',
    },
    {
        name: 'isinstance',
        kind: CompletionItemKind.Function,
        signature: 'isinstance(object: object, classinfo: type | tuple[type, ...]) -> bool',
        doc: 'Return whether an object is an instance of a class or of a subclass thereof.',
        returnType: 'bool',
    },
    {
        name: 'issubclass',
        kind: CompletionItemKind.Function,
        signature: 'issubclass(cls: type, classinfo: type | tuple[type, ...]) -> bool',
        doc: 'Return whether `cls` is a derived from another class or is the same class.',
        returnType: 'bool',
    },
    {
        name: 'hasattr',
        kind: CompletionItemKind.Function,
        signature: 'hasattr(object: object, name: str) -> bool',
        doc: 'Return whether the object has an attribute with the given name.',
        returnType: 'bool',
    },
    {
        name: 'getattr',
        kind: CompletionItemKind.Function,
        signature: 'getattr(object: object, name: str, default: Any = ...) -> Any',
        doc: 'Get a named attribute from an object (`getattr(x, "y")` is equivalent to `x.y`).',
    },
    {
        name: 'setattr',
        kind: CompletionItemKind.Function,
        signature: 'setattr(object: object, name: str, value: Any) -> None',
        doc: 'Sets the named attribute on the given object to the specified value.',
    },
    {
        name: 'delattr',
        kind: CompletionItemKind.Function,
        signature: 'delattr(object: object, name: str) -> None',
        doc: 'Deletes the named attribute from the given object.',
    },
    {
        name: 'open',
        kind: CompletionItemKind.Function,
        signature: "open(file: str | Path, mode: str = 'r', encoding: str | None = None) -> IO",
        doc: 'Open file and return a stream.',
    },
    {
        name: 'input',
        kind: CompletionItemKind.Function,
        signature: 'input(prompt: str = "") -> str',
        doc: 'Read a string from standard input.',
        returnType: 'str',
    },
    {
        name: 'iter',
        kind: CompletionItemKind.Function,
        signature: 'iter(iterable: Iterable[T]) -> Iterator[T]',
        doc: 'Get an iterator from an object.',
    },
    {
        name: 'next',
        kind: CompletionItemKind.Function,
        signature: 'next(iterator: Iterator[T], default: T = ...) -> T',
        doc: 'Return the next item from the iterator.',
    },
    {
        name: 'repr',
        kind: CompletionItemKind.Function,
        signature: 'repr(obj: object) -> str',
        doc: 'Return the canonical string representation of the object.',
        returnType: 'str',
    },
    {
        name: 'ascii',
        kind: CompletionItemKind.Function,
        signature: 'ascii(obj: object) -> str',
        doc: 'Return an ASCII-only representation of an object.',
        returnType: 'str',
    },
    {
        name: 'format',
        kind: CompletionItemKind.Function,
        signature: 'format(value: object, format_spec: str = "") -> str',
        doc: 'Convert a value to a formatted representation.',
        returnType: 'str',
    },
    {
        name: 'chr',
        kind: CompletionItemKind.Function,
        signature: 'chr(i: int) -> str',
        doc: 'Return a Unicode string of one character with ordinal `i`.',
        returnType: 'str',
    },
    {
        name: 'ord',
        kind: CompletionItemKind.Function,
        signature: 'ord(c: str) -> int',
        doc: 'Return the Unicode code point for a one-character string.',
        returnType: 'int',
    },
    {
        name: 'hex',
        kind: CompletionItemKind.Function,
        signature: 'hex(number: int) -> str',
        doc: 'Return the hexadecimal representation of an integer.',
        returnType: 'str',
    },
    {
        name: 'oct',
        kind: CompletionItemKind.Function,
        signature: 'oct(number: int) -> str',
        doc: 'Return the octal representation of an integer.',
        returnType: 'str',
    },
    {
        name: 'bin',
        kind: CompletionItemKind.Function,
        signature: 'bin(number: int) -> str',
        doc: 'Return the binary representation of an integer.',
        returnType: 'str',
    },
    {
        name: 'id',
        kind: CompletionItemKind.Function,
        signature: 'id(obj: object) -> int',
        doc: 'Return the identity of an object.',
        returnType: 'int',
    },
    {
        name: 'hash',
        kind: CompletionItemKind.Function,
        signature: 'hash(obj: object) -> int',
        doc: 'Return the hash value for the given object.',
        returnType: 'int',
    },
    {
        name: 'callable',
        kind: CompletionItemKind.Function,
        signature: 'callable(obj: object) -> bool',
        doc: 'Return whether the object is callable.',
        returnType: 'bool',
    },
    {
        name: 'vars',
        kind: CompletionItemKind.Function,
        signature: 'vars(object: object = ...) -> dict[str, Any]',
        doc: 'Return the `__dict__` attribute for a module, class, instance, or object.',
        returnType: 'dict',
    },
    {
        name: 'dir',
        kind: CompletionItemKind.Function,
        signature: 'dir(object: object = ...) -> list[str]',
        doc: 'Return an alphabetized list of names comprising some of the attributes of the given object.',
        returnType: 'list',
    },
    {
        name: 'globals',
        kind: CompletionItemKind.Function,
        signature: 'globals() -> dict[str, Any]',
        doc: 'Return the dictionary containing the current scope\'s global variables.',
        returnType: 'dict',
    },
    {
        name: 'locals',
        kind: CompletionItemKind.Function,
        signature: 'locals() -> dict[str, Any]',
        doc: 'Return a dictionary containing the current scope\'s local variables.',
        returnType: 'dict',
    },
    {
        name: 'breakpoint',
        kind: CompletionItemKind.Function,
        signature: 'breakpoint(*args: Any, **kws: Any) -> None',
        doc: 'Drops into the debugger at the call site.',
    },
    {
        name: 'compile',
        kind: CompletionItemKind.Function,
        signature: 'compile(source: str, filename: str, mode: str) -> CodeType',
        doc: 'Compile source into a code object that can be executed by `exec()` or `eval()`.',
    },
    {
        name: 'eval',
        kind: CompletionItemKind.Function,
        signature: 'eval(expression: str, globals: dict | None = None, locals: Mapping | None = None) -> Any',
        doc: 'Evaluate the given source in the context of globals and locals.',
    },
    {
        name: 'exec',
        kind: CompletionItemKind.Function,
        signature: 'exec(source: str, globals: dict | None = None, locals: Mapping | None = None) -> None',
        doc: 'Execute the given source in the context of globals and locals.',
    },
    {
        name: 'aiter',
        kind: CompletionItemKind.Function,
        signature: 'aiter(async_iterable: AsyncIterable[T]) -> AsyncIterator[T]',
        doc: 'Return an `AsyncIterator` for an `AsyncIterable` object.',
    },
    {
        name: 'anext',
        kind: CompletionItemKind.Function,
        signature: 'anext(async_iterator: AsyncIterator[T], default: T = ...) -> Awaitable[T]',
        doc: 'Return the next item from the async iterator.',
    },
    {
        name: 'help',
        kind: CompletionItemKind.Function,
        signature: 'help(request: object = ...) -> None',
        doc: 'Invoke the built-in help system.',
    },

    // Built-in types & decorators
    {
        name: 'str',
        kind: CompletionItemKind.Class,
        signature: "class str(object: object = '')",
        doc: 'Create a new string object from the given object.',
        returnType: 'str',
    },
    {
        name: 'int',
        kind: CompletionItemKind.Class,
        signature: 'class int(x: str | bytes | SupportsInt = 0, base: int = 10)',
        doc: 'Convert a number or string to an integer.',
        returnType: 'int',
    },
    {
        name: 'float',
        kind: CompletionItemKind.Class,
        signature: 'class float(x: str | bytes | SupportsFloat = 0.0)',
        doc: 'Convert a string or number to a floating-point number.',
        returnType: 'float',
    },
    {
        name: 'bool',
        kind: CompletionItemKind.Class,
        signature: 'class bool(x: object = False)',
        doc: 'Return `True` when the argument is true, `False` otherwise.',
        returnType: 'bool',
    },
    {
        name: 'list',
        kind: CompletionItemKind.Class,
        signature: 'class list(iterable: Iterable[T] = ())',
        doc: 'Built-in mutable sequence.',
        returnType: 'list',
    },
    {
        name: 'dict',
        kind: CompletionItemKind.Class,
        signature: 'class dict(**kwargs: Any)',
        doc: 'Built-in mutable mapping dictionary.',
        returnType: 'dict',
    },
    {
        name: 'set',
        kind: CompletionItemKind.Class,
        signature: 'class set(iterable: Iterable[T] = ())',
        doc: 'Built-in mutable unordered collection of unique elements.',
        returnType: 'set',
    },
    {
        name: 'tuple',
        kind: CompletionItemKind.Class,
        signature: 'class tuple(iterable: Iterable[T] = ())',
        doc: 'Built-in immutable sequence.',
        returnType: 'tuple',
    },
    {
        name: 'frozenset',
        kind: CompletionItemKind.Class,
        signature: 'class frozenset(iterable: Iterable[T] = ())',
        doc: 'Built-in immutable unordered collection of unique elements.',
        returnType: 'set',
    },
    {
        name: 'bytes',
        kind: CompletionItemKind.Class,
        signature: 'class bytes(source: Iterable[int] | str = b"")',
        doc: 'Built-in immutable sequence of bytes.',
        returnType: 'bytes',
    },
    {
        name: 'bytearray',
        kind: CompletionItemKind.Class,
        signature: 'class bytearray(source: Iterable[int] | str = b"")',
        doc: 'Built-in mutable sequence of bytes.',
    },
    {
        name: 'memoryview',
        kind: CompletionItemKind.Class,
        signature: 'class memoryview(obj: Buffer)',
        doc: 'Create a new memoryview object which references the given object.',
    },
    {
        name: 'complex',
        kind: CompletionItemKind.Class,
        signature: 'class complex(real: float = 0, imag: float = 0)',
        doc: 'Create a complex number from a real part and an optional imaginary part.',
    },
    {
        name: 'object',
        kind: CompletionItemKind.Class,
        signature: 'class object()',
        doc: 'The base class of the class hierarchy.',
    },
    {
        name: 'type',
        kind: CompletionItemKind.Class,
        signature: 'class type(object: object) | type(name: str, bases: tuple, dict: dict)',
        doc: 'Return the type of an object or construct a new type.',
    },
    {
        name: 'super',
        kind: CompletionItemKind.Class,
        signature: 'class super(type: type = ..., obj: object = ...)',
        doc: 'Return a proxy object that delegates method calls to a parent or sibling class.',
    },
    {
        name: 'property',
        kind: CompletionItemKind.Class,
        signature: 'class property(fget=None, fset=None, fdel=None, doc=None)',
        doc: 'Property attribute descriptor decorator.',
    },
    {
        name: 'staticmethod',
        kind: CompletionItemKind.Class,
        signature: '@staticmethod',
        doc: 'Transform a method into a static method.',
    },
    {
        name: 'classmethod',
        kind: CompletionItemKind.Class,
        signature: '@classmethod',
        doc: 'Transform a method into a class method.',
    },
    {
        name: 'slice',
        kind: CompletionItemKind.Class,
        signature: 'class slice(start: int | None, stop: int | None, step: int | None = None)',
        doc: 'Create a slice object used for extended slicing.',
    },

    // Built-in exceptions
    { name: 'BaseException', kind: CompletionItemKind.Class, signature: 'class BaseException(*args: object)', doc: 'Common base class for all exceptions.' },
    { name: 'Exception', kind: CompletionItemKind.Class, signature: 'class Exception(*args: object)', doc: 'Common base class for all non-exit exceptions.' },
    { name: 'ValueError', kind: CompletionItemKind.Class, signature: 'class ValueError(*args: object)', doc: 'Inappropriate argument value (of correct type).' },
    { name: 'TypeError', kind: CompletionItemKind.Class, signature: 'class TypeError(*args: object)', doc: 'Inappropriate argument type.' },
    { name: 'RuntimeError', kind: CompletionItemKind.Class, signature: 'class RuntimeError(*args: object)', doc: 'Unspecified run-time error.' },
    { name: 'KeyError', kind: CompletionItemKind.Class, signature: 'class KeyError(*args: object)', doc: 'Mapping key not found.' },
    { name: 'IndexError', kind: CompletionItemKind.Class, signature: 'class IndexError(*args: object)', doc: 'Sequence index out of range.' },
    { name: 'AttributeError', kind: CompletionItemKind.Class, signature: 'class AttributeError(*args: object)', doc: 'Attribute not found.' },
    { name: 'NameError', kind: CompletionItemKind.Class, signature: 'class NameError(*args: object)', doc: 'Name not found globally or locally.' },
    { name: 'ZeroDivisionError', kind: CompletionItemKind.Class, signature: 'class ZeroDivisionError(*args: object)', doc: 'Second argument to a division or modulo operation was zero.' },
    { name: 'FileNotFoundError', kind: CompletionItemKind.Class, signature: 'class FileNotFoundError(*args: object)', doc: 'File or directory does not exist.' },
    { name: 'FileExistsError', kind: CompletionItemKind.Class, signature: 'class FileExistsError(*args: object)', doc: 'Trying to create a file or directory which already exists.' },
    { name: 'PermissionError', kind: CompletionItemKind.Class, signature: 'class PermissionError(*args: object)', doc: 'Trying to run an operation without the adequate access rights.' },
    { name: 'TimeoutError', kind: CompletionItemKind.Class, signature: 'class TimeoutError(*args: object)', doc: 'Timeout expired at the OS or operation level.' },
    { name: 'OSError', kind: CompletionItemKind.Class, signature: 'class OSError(*args: object)', doc: 'Base class for I/O related errors.' },
    { name: 'IOError', kind: CompletionItemKind.Class, signature: 'class IOError(*args: object)', doc: 'Alias for `OSError`.' },
    { name: 'ImportError', kind: CompletionItemKind.Class, signature: 'class ImportError(*args: object)', doc: 'Import cannot find module, or cannot find name in module.' },
    { name: 'ModuleNotFoundError', kind: CompletionItemKind.Class, signature: 'class ModuleNotFoundError(*args: object)', doc: 'Module not found.' },
    { name: 'StopIteration', kind: CompletionItemKind.Class, signature: 'class StopIteration(*args: object)', doc: 'Signal the end from `iterator.__next__()`.' },
    { name: 'StopAsyncIteration', kind: CompletionItemKind.Class, signature: 'class StopAsyncIteration(*args: object)', doc: 'Signal the end from `aiterator.__anext__()`.' },
    { name: 'AssertionError', kind: CompletionItemKind.Class, signature: 'class AssertionError(*args: object)', doc: 'Result of failed `assert` statement.' },
    { name: 'NotImplementedError', kind: CompletionItemKind.Class, signature: 'class NotImplementedError(*args: object)', doc: 'Method or function hasn\'t been implemented yet.' },
    { name: 'SystemExit', kind: CompletionItemKind.Class, signature: 'class SystemExit(*args: object)', doc: 'Request to exit from the interpreter.' },
    { name: 'KeyboardInterrupt', kind: CompletionItemKind.Class, signature: 'class KeyboardInterrupt(*args: object)', doc: 'Program interrupted by user.' },
    { name: 'GeneratorExit', kind: CompletionItemKind.Class, signature: 'class GeneratorExit(*args: object)', doc: 'Request that a generator exit.' },
    { name: 'SyntaxError', kind: CompletionItemKind.Class, signature: 'class SyntaxError(*args: object)', doc: 'Invalid Python syntax.' },
    { name: 'IndentationError', kind: CompletionItemKind.Class, signature: 'class IndentationError(*args: object)', doc: 'Improper indentation.' },
    { name: 'TabError', kind: CompletionItemKind.Class, signature: 'class TabError(*args: object)', doc: 'Improper mixture of spaces and tabs.' },
    { name: 'LookupError', kind: CompletionItemKind.Class, signature: 'class LookupError(*args: object)', doc: 'Base class for lookup errors.' },
    { name: 'ArithmeticError', kind: CompletionItemKind.Class, signature: 'class ArithmeticError(*args: object)', doc: 'Base class for arithmetic errors.' },
    { name: 'EOFError', kind: CompletionItemKind.Class, signature: 'class EOFError(*args: object)', doc: 'Read beyond end of file.' },
    { name: 'MemoryError', kind: CompletionItemKind.Class, signature: 'class MemoryError(*args: object)', doc: 'Out of memory.' },
    { name: 'OverflowError', kind: CompletionItemKind.Class, signature: 'class OverflowError(*args: object)', doc: 'Result too large to be represented.' },
    { name: 'RecursionError', kind: CompletionItemKind.Class, signature: 'class RecursionError(*args: object)', doc: 'Maximum recursion depth exceeded.' },
    { name: 'BufferError', kind: CompletionItemKind.Class, signature: 'class BufferError(*args: object)', doc: 'Buffer error.' },
    { name: 'ReferenceError', kind: CompletionItemKind.Class, signature: 'class ReferenceError(*args: object)', doc: 'Weak ref proxy used after referent went away.' },
    { name: 'SystemError', kind: CompletionItemKind.Class, signature: 'class SystemError(*args: object)', doc: 'Internal interpreter error.' },
    { name: 'UnboundLocalError', kind: CompletionItemKind.Class, signature: 'class UnboundLocalError(*args: object)', doc: 'Local name referenced but not bound to a value.' },
    { name: 'UnicodeError', kind: CompletionItemKind.Class, signature: 'class UnicodeError(*args: object)', doc: 'Unicode related error.' },
    { name: 'UnicodeDecodeError', kind: CompletionItemKind.Class, signature: 'class UnicodeDecodeError(*args: object)', doc: 'Unicode decoding error.' },
    { name: 'UnicodeEncodeError', kind: CompletionItemKind.Class, signature: 'class UnicodeEncodeError(*args: object)', doc: 'Unicode encoding error.' },
    { name: 'ConnectionError', kind: CompletionItemKind.Class, signature: 'class ConnectionError(*args: object)', doc: 'Connection error.' },
    { name: 'Warning', kind: CompletionItemKind.Class, signature: 'class Warning(*args: object)', doc: 'Base class for warning categories.' },
    { name: 'UserWarning', kind: CompletionItemKind.Class, signature: 'class UserWarning(*args: object)', doc: 'Base class for warnings generated by user code.' },
    { name: 'DeprecationWarning', kind: CompletionItemKind.Class, signature: 'class DeprecationWarning(*args: object)', doc: 'Base class for warnings about deprecated features.' },

    // Built-in constants & special variables
    { name: 'Ellipsis', kind: CompletionItemKind.Constant, signature: 'Ellipsis: ellipsis', doc: 'The `...` singleton object.' },
    { name: 'NotImplemented', kind: CompletionItemKind.Constant, signature: 'NotImplemented: _NotImplementedType', doc: 'Special value returned by binary special methods.' },
    { name: '__name__', kind: CompletionItemKind.Variable, signature: '__name__: str', doc: 'The name of the current module (`"__main__"` when executed directly).', returnType: 'str' },
    { name: '__file__', kind: CompletionItemKind.Variable, signature: '__file__: str', doc: 'The pathname of the file from which the module was loaded.', returnType: 'str' },
    { name: '__doc__', kind: CompletionItemKind.Variable, signature: '__doc__: str | None', doc: 'The module\'s documentation string.' },
];

export const BUILTIN_MAP = new Map<string, BuiltinSpec>(PYTHON_BUILTINS.map((b) => [b.name, b]));

const EXTRA_KNOWN_BUILTINS = new Set<string>([
    '__import__',
    '__package__',
    '__spec__',
    '__annotations__',
    '__builtins__',
    '__debug__',
    '__loader__',
    '__cached__',
    'BlockingIOError',
    'BrokenPipeError',
    'BytesWarning',
    'ChildProcessError',
    'ConnectionAbortedError',
    'ConnectionRefusedError',
    'ConnectionResetError',
    'EncodingWarning',
    'EnvironmentError',
    'FloatingPointError',
    'FutureWarning',
    'ImportWarning',
    'InterruptedError',
    'IsADirectoryError',
    'NotADirectoryError',
    'PendingDeprecationWarning',
    'ProcessLookupError',
    'ResourceWarning',
    'RuntimeWarning',
    'SyntaxWarning',
    'UnicodeTranslateError',
    'UnicodeWarning',
    'ExceptionGroup',
    'BaseExceptionGroup',
    '_',
]);

export const PYTHON_KEYWORD_DOCS: Record<string, string> = {
    def: '**`def`** — Defines a Python function or method.\n\n```python\ndef compute(x: int) -> int:\n    return x * 2\n```',
    async: '**`async`** — Declares an asynchronous coroutine function (`async def`), context manager (`async with`), or loop (`async for`).',
    await: '**`await`** — Suspends execution of an `async` coroutine until an awaitable (such as `await ask(...)`, `await agent(...)`, or `await asyncio.gather(...)`) completes.',
    class: '**`class`** — Defines a new Python class (such as a Pydantic `BaseModel` schema).',
    import: '**`import`** — Imports a Python or `.spl2` module.',
    from: '**`from <module> import <name>`** — Imports specific attributes or types from a module.',
    return: '**`return`** — Exits a function and returns a value to the caller.',
    yield: '**`yield`** — Produces a value from a generator function.',
    if: '**`if <condition>:`** — Conditional execution branch.',
    elif: '**`elif <condition>:`** — Else-if conditional branch.',
    else: '**`else:`** — Fallback branch for `if`, `for`, `while`, or `try`.',
    for: '**`for <target> in <iterable>:`** — Iterates over the items of any sequence or iterable.',
    while: '**`while <condition>:`** — Repeats a block as long as a condition remains true.',
    try: '**`try:`** — Specifies exception handlers and/or cleanup code for a group of statements.',
    except: '**`except <ExceptionType> as <var>:`** — Catches and handles exceptions raised in a `try` block.',
    finally: '**`finally:`** — Specifies a cleanup block that always executes when leaving a `try` statement.',
    with: '**`with <expr> as <var>:`** — Wraps the execution of a block with methods defined by a context manager.',
    assert: '**`assert <condition>, <message>`** — Raises an `AssertionError` if the condition evaluates to false.',
    raise: '**`raise <Exception>`** — Raises an exception.',
    lambda: '**`lambda <params>: <expr>`** — Creates an anonymous inline function.',
    match: '**`match <subject>:`** — Structural pattern matching statement (Python 3.10+).',
    case: '**`case <pattern>:`** — Pattern branch inside a `match` statement.',
};

export interface MemberSpec {
    name: string;
    kind: CompletionItemKind;
    detail: string;
    doc: string;
}

export const PYTHON_TYPE_METHODS: Record<string, readonly MemberSpec[]> = {
    str: [
        { name: 'split', kind: CompletionItemKind.Method, detail: 'str.split(sep: str | None = None, maxsplit: int = -1) -> list[str]', doc: 'Return a list of the substrings in the string, using `sep` as the separator string.' },
        { name: 'splitlines', kind: CompletionItemKind.Method, detail: 'str.splitlines(keepends: bool = False) -> list[str]', doc: 'Return a list of the lines in the string, breaking at line boundaries.' },
        { name: 'strip', kind: CompletionItemKind.Method, detail: 'str.strip(chars: str | None = None) -> str', doc: 'Return a copy of the string with leading and trailing whitespace removed.' },
        { name: 'lstrip', kind: CompletionItemKind.Method, detail: 'str.lstrip(chars: str | None = None) -> str', doc: 'Return a copy of the string with leading whitespace removed.' },
        { name: 'rstrip', kind: CompletionItemKind.Method, detail: 'str.rstrip(chars: str | None = None) -> str', doc: 'Return a copy of the string with trailing whitespace removed.' },
        { name: 'join', kind: CompletionItemKind.Method, detail: 'str.join(iterable: Iterable[str]) -> str', doc: 'Concatenate any number of strings.' },
        { name: 'lower', kind: CompletionItemKind.Method, detail: 'str.lower() -> str', doc: 'Return a copy of the string converted to lowercase.' },
        { name: 'upper', kind: CompletionItemKind.Method, detail: 'str.upper() -> str', doc: 'Return a copy of the string converted to uppercase.' },
        { name: 'title', kind: CompletionItemKind.Method, detail: 'str.title() -> str', doc: 'Return a version of the string where each word is titlecased.' },
        { name: 'capitalize', kind: CompletionItemKind.Method, detail: 'str.capitalize() -> str', doc: 'Return a capitalized version of the string.' },
        { name: 'replace', kind: CompletionItemKind.Method, detail: 'str.replace(old: str, new: str, count: int = -1) -> str', doc: 'Return a copy with all occurrences of substring `old` replaced by `new`.' },
        { name: 'startswith', kind: CompletionItemKind.Method, detail: 'str.startswith(prefix: str | tuple[str, ...]) -> bool', doc: 'Return `True` if string starts with the specified prefix.' },
        { name: 'endswith', kind: CompletionItemKind.Method, detail: 'str.endswith(suffix: str | tuple[str, ...]) -> bool', doc: 'Return `True` if string ends with the specified suffix.' },
        { name: 'find', kind: CompletionItemKind.Method, detail: 'str.find(sub: str, start: int = 0, end: int = ...) -> int', doc: 'Return the lowest index in the string where substring `sub` is found, or `-1`.' },
        { name: 'rfind', kind: CompletionItemKind.Method, detail: 'str.rfind(sub: str, start: int = 0, end: int = ...) -> int', doc: 'Return the highest index in the string where substring `sub` is found, or `-1`.' },
        { name: 'index', kind: CompletionItemKind.Method, detail: 'str.index(sub: str, start: int = 0, end: int = ...) -> int', doc: 'Like `find()`, but raise `ValueError` when the substring is not found.' },
        { name: 'count', kind: CompletionItemKind.Method, detail: 'str.count(sub: str, start: int = 0, end: int = ...) -> int', doc: 'Return the number of non-overlapping occurrences of substring `sub`.' },
        { name: 'format', kind: CompletionItemKind.Method, detail: 'str.format(*args: object, **kwargs: object) -> str', doc: 'Perform a string formatting operation.' },
        { name: 'encode', kind: CompletionItemKind.Method, detail: "str.encode(encoding: str = 'utf-8', errors: str = 'strict') -> bytes", doc: 'Encode the string using the codec registered for encoding.' },
        { name: 'isdigit', kind: CompletionItemKind.Method, detail: 'str.isdigit() -> bool', doc: 'Return `True` if all characters in the string are digits.' },
        { name: 'isalpha', kind: CompletionItemKind.Method, detail: 'str.isalpha() -> bool', doc: 'Return `True` if all characters in the string are alphabetic.' },
        { name: 'isalnum', kind: CompletionItemKind.Method, detail: 'str.isalnum() -> bool', doc: 'Return `True` if all characters in the string are alpha-numeric.' },
        { name: 'isspace', kind: CompletionItemKind.Method, detail: 'str.isspace() -> bool', doc: 'Return `True` if all characters in the string are whitespace.' },
        { name: 'removeprefix', kind: CompletionItemKind.Method, detail: 'str.removeprefix(prefix: str) -> str', doc: 'Return a str with the given `prefix` string removed if present.' },
        { name: 'removesuffix', kind: CompletionItemKind.Method, detail: 'str.removesuffix(suffix: str) -> str', doc: 'Return a str with the given `suffix` string removed if present.' },
        { name: 'partition', kind: CompletionItemKind.Method, detail: 'str.partition(sep: str) -> tuple[str, str, str]', doc: 'Partition the string into three parts using the given separator.' },
    ],
    list: [
        { name: 'append', kind: CompletionItemKind.Method, detail: 'list.append(object: T) -> None', doc: 'Append object to the end of the list.' },
        { name: 'extend', kind: CompletionItemKind.Method, detail: 'list.extend(iterable: Iterable[T]) -> None', doc: 'Extend list by appending elements from the iterable.' },
        { name: 'insert', kind: CompletionItemKind.Method, detail: 'list.insert(index: int, object: T) -> None', doc: 'Insert object before index.' },
        { name: 'remove', kind: CompletionItemKind.Method, detail: 'list.remove(value: T) -> None', doc: 'Remove first occurrence of value.' },
        { name: 'pop', kind: CompletionItemKind.Method, detail: 'list.pop(index: int = -1) -> T', doc: 'Remove and return item at index (default last).' },
        { name: 'clear', kind: CompletionItemKind.Method, detail: 'list.clear() -> None', doc: 'Remove all items from list.' },
        { name: 'index', kind: CompletionItemKind.Method, detail: 'list.index(value: T, start: int = 0, stop: int = ...) -> int', doc: 'Return first index of value.' },
        { name: 'count', kind: CompletionItemKind.Method, detail: 'list.count(value: T) -> int', doc: 'Return number of occurrences of value.' },
        { name: 'sort', kind: CompletionItemKind.Method, detail: 'list.sort(*, key: Callable | None = None, reverse: bool = False) -> None', doc: 'Sort the list in ascending order in-place.' },
        { name: 'reverse', kind: CompletionItemKind.Method, detail: 'list.reverse() -> None', doc: 'Reverse *IN PLACE*.' },
        { name: 'copy', kind: CompletionItemKind.Method, detail: 'list.copy() -> list[T]', doc: 'Return a shallow copy of the list.' },
    ],
    dict: [
        { name: 'get', kind: CompletionItemKind.Method, detail: 'dict.get(key: K, default: V | None = None) -> V | None', doc: 'Return the value for `key` if `key` is in the dictionary, else `default`.' },
        { name: 'keys', kind: CompletionItemKind.Method, detail: 'dict.keys() -> dict_keys[K]', doc: 'Return a set-like object providing a view on the dict\'s keys.' },
        { name: 'values', kind: CompletionItemKind.Method, detail: 'dict.values() -> dict_values[V]', doc: 'Return an object providing a view on the dict\'s values.' },
        { name: 'items', kind: CompletionItemKind.Method, detail: 'dict.items() -> dict_items[K, V]', doc: 'Return a set-like object providing a view on the dict\'s `(key, value)` pairs.' },
        { name: 'pop', kind: CompletionItemKind.Method, detail: 'dict.pop(key: K, default: V = ...) -> V', doc: 'Remove specified key and return the corresponding value.' },
        { name: 'popitem', kind: CompletionItemKind.Method, detail: 'dict.popitem() -> tuple[K, V]', doc: 'Remove and return a `(key, value)` pair as a 2-tuple.' },
        { name: 'update', kind: CompletionItemKind.Method, detail: 'dict.update(m: Mapping[K, V] = ..., **kwargs: V) -> None', doc: 'Update the dictionary with the key/value pairs from `m`.' },
        { name: 'setdefault', kind: CompletionItemKind.Method, detail: 'dict.setdefault(key: K, default: V | None = None) -> V', doc: 'Insert key with a value of default if key is not in the dictionary.' },
        { name: 'clear', kind: CompletionItemKind.Method, detail: 'dict.clear() -> None', doc: 'Remove all items from the dictionary.' },
        { name: 'copy', kind: CompletionItemKind.Method, detail: 'dict.copy() -> dict[K, V]', doc: 'Return a shallow copy of the dictionary.' },
    ],
    set: [
        { name: 'add', kind: CompletionItemKind.Method, detail: 'set.add(element: T) -> None', doc: 'Add an element to a set.' },
        { name: 'remove', kind: CompletionItemKind.Method, detail: 'set.remove(element: T) -> None', doc: 'Remove an element from a set; it must be a member.' },
        { name: 'discard', kind: CompletionItemKind.Method, detail: 'set.discard(element: T) -> None', doc: 'Remove an element from a set if it is a member.' },
        { name: 'pop', kind: CompletionItemKind.Method, detail: 'set.pop() -> T', doc: 'Remove and return an arbitrary set element.' },
        { name: 'clear', kind: CompletionItemKind.Method, detail: 'set.clear() -> None', doc: 'Remove all elements from this set.' },
        { name: 'union', kind: CompletionItemKind.Method, detail: 'set.union(*s: Iterable[T]) -> set[T]', doc: 'Return the union of sets as a new set.' },
        { name: 'intersection', kind: CompletionItemKind.Method, detail: 'set.intersection(*s: Iterable[T]) -> set[T]', doc: 'Return the intersection of two sets as a new set.' },
        { name: 'difference', kind: CompletionItemKind.Method, detail: 'set.difference(*s: Iterable[T]) -> set[T]', doc: 'Return the difference of two or more sets as a new set.' },
        { name: 'update', kind: CompletionItemKind.Method, detail: 'set.update(*s: Iterable[T]) -> None', doc: 'Update a set with the union of itself and others.' },
        { name: 'issubset', kind: CompletionItemKind.Method, detail: 'set.issubset(s: Iterable[Any]) -> bool', doc: 'Report whether another set contains this set.' },
        { name: 'issuperset', kind: CompletionItemKind.Method, detail: 'set.issuperset(s: Iterable[Any]) -> bool', doc: 'Report whether this set contains another set.' },
        { name: 'copy', kind: CompletionItemKind.Method, detail: 'set.copy() -> set[T]', doc: 'Return a shallow copy of a set.' },
    ],
    tuple: [
        { name: 'count', kind: CompletionItemKind.Method, detail: 'tuple.count(value: Any) -> int', doc: 'Return number of occurrences of value.' },
        { name: 'index', kind: CompletionItemKind.Method, detail: 'tuple.index(value: Any, start: int = 0, stop: int = ...) -> int', doc: 'Return first index of value.' },
    ],
    BaseModel: [
        { name: 'model_dump', kind: CompletionItemKind.Method, detail: 'BaseModel.model_dump(*, mode: str = "python", include=None, exclude=None, by_alias: bool = False, exclude_none: bool = False) -> dict[str, Any]', doc: 'Generate a dictionary representation of the Pydantic model.' },
        { name: 'model_dump_json', kind: CompletionItemKind.Method, detail: 'BaseModel.model_dump_json(*, indent: int | None = None, include=None, exclude=None, by_alias: bool = False, exclude_none: bool = False) -> str', doc: 'Generates a JSON string representation of the Pydantic model.' },
        { name: 'model_validate', kind: CompletionItemKind.Method, detail: 'BaseModel.model_validate(obj: Any, *, strict: bool | None = None) -> Self', doc: 'Validate a Python object instance against the Pydantic model.' },
        { name: 'model_validate_json', kind: CompletionItemKind.Method, detail: 'BaseModel.model_validate_json(json_data: str | bytes, *, strict: bool | None = None) -> Self', doc: 'Validate the given JSON data against the Pydantic model.' },
        { name: 'model_copy', kind: CompletionItemKind.Method, detail: 'BaseModel.model_copy(*, update: dict[str, Any] | None = None, deep: bool = False) -> Self', doc: 'Returns a copy of the model.' },
        { name: 'model_json_schema', kind: CompletionItemKind.Method, detail: 'BaseModel.model_json_schema() -> dict[str, Any]', doc: 'Generates a JSON schema for a model class.' },
        { name: 'model_fields', kind: CompletionItemKind.Property, detail: 'BaseModel.model_fields: dict[str, FieldInfo]', doc: 'Metadata about the fields defined on the model.' },
    ],
    Path: [
        { name: 'read_text', kind: CompletionItemKind.Method, detail: "Path.read_text(encoding: str | None = 'utf-8', errors: str | None = None) -> str", doc: 'Open the file in text mode, read it, and close the file.' },
        { name: 'write_text', kind: CompletionItemKind.Method, detail: "Path.write_text(data: str, encoding: str | None = 'utf-8') -> int", doc: 'Open the file in text mode, write to it, and close the file.' },
        { name: 'read_bytes', kind: CompletionItemKind.Method, detail: 'Path.read_bytes() -> bytes', doc: 'Open the file in binary mode, read it, and close the file.' },
        { name: 'write_bytes', kind: CompletionItemKind.Method, detail: 'Path.write_bytes(data: bytes) -> int', doc: 'Open the file in binary mode, write to it, and close the file.' },
        { name: 'exists', kind: CompletionItemKind.Method, detail: 'Path.exists() -> bool', doc: 'Whether this path exists.' },
        { name: 'is_file', kind: CompletionItemKind.Method, detail: 'Path.is_file() -> bool', doc: 'Whether this path is a regular file.' },
        { name: 'is_dir', kind: CompletionItemKind.Method, detail: 'Path.is_dir() -> bool', doc: 'Whether this path is a directory.' },
        { name: 'glob', kind: CompletionItemKind.Method, detail: 'Path.glob(pattern: str) -> Iterator[Path]', doc: 'Iterate over this subtree and yield all existing files matching the given relative pattern.' },
        { name: 'rglob', kind: CompletionItemKind.Method, detail: 'Path.rglob(pattern: str) -> Iterator[Path]', doc: 'Recursively yield all existing files matching the given relative pattern.' },
        { name: 'iterdir', kind: CompletionItemKind.Method, detail: 'Path.iterdir() -> Iterator[Path]', doc: 'Yield path objects of the directory contents.' },
        { name: 'resolve', kind: CompletionItemKind.Method, detail: 'Path.resolve(strict: bool = False) -> Path', doc: 'Make the path absolute, resolving all symlinks on the way.' },
        { name: 'mkdir', kind: CompletionItemKind.Method, detail: 'Path.mkdir(mode: int = 0o777, parents: bool = False, exist_ok: bool = False) -> None', doc: 'Create a new directory at this given path.' },
        { name: 'unlink', kind: CompletionItemKind.Method, detail: 'Path.unlink(missing_ok: bool = False) -> None', doc: 'Remove this file or link.' },
        { name: 'with_name', kind: CompletionItemKind.Method, detail: 'Path.with_name(name: str) -> Path', doc: 'Return a new path with the file name changed.' },
        { name: 'with_suffix', kind: CompletionItemKind.Method, detail: 'Path.with_suffix(suffix: str) -> Path', doc: 'Return a new path with the file suffix changed.' },
        { name: 'parent', kind: CompletionItemKind.Property, detail: 'Path.parent: Path', doc: 'The logical parent of the path.' },
        { name: 'name', kind: CompletionItemKind.Property, detail: 'Path.name: str', doc: 'The final path component, if any.' },
        { name: 'stem', kind: CompletionItemKind.Property, detail: 'Path.stem: str', doc: 'The final path component, minus its last suffix.' },
        { name: 'suffix', kind: CompletionItemKind.Property, detail: 'Path.suffix: str', doc: 'The final component\'s last suffix, if any.' },
    ],
};

export const PYTHON_MODULES: Record<string, { doc: string; exports: readonly MemberSpec[] }> = {
    asyncio: {
        doc: 'Asynchronous I/O, event loop, coroutines, and tasks.',
        exports: [
            { name: 'run', kind: CompletionItemKind.Function, detail: 'asyncio.run(main: Coroutine[Any, Any, T]) -> T', doc: 'Execute the coroutine `main` and return the result.' },
            { name: 'gather', kind: CompletionItemKind.Function, detail: 'asyncio.gather(*aws: Awaitable, return_exceptions: bool = False) -> Future[list]', doc: 'Run awaitable objects in the `aws` sequence concurrently.' },
            { name: 'sleep', kind: CompletionItemKind.Function, detail: 'asyncio.sleep(delay: float, result: T = ...) -> Coroutine[Any, Any, T]', doc: 'Coroutine that completes after a given time (in seconds).' },
            { name: 'create_task', kind: CompletionItemKind.Function, detail: 'asyncio.create_task(coro: Coroutine[Any, Any, T]) -> Task[T]', doc: 'Schedule the execution of a coroutine object in a spawn task.' },
            { name: 'wait_for', kind: CompletionItemKind.Function, detail: 'asyncio.wait_for(aw: Awaitable[T], timeout: float | None) -> Coroutine[Any, Any, T]', doc: 'Wait for the single Future or coroutine to complete, with timeout.' },
            { name: 'Queue', kind: CompletionItemKind.Class, detail: 'class asyncio.Queue(maxsize: int = 0)', doc: 'A queue, useful for coordinating producer and consumer coroutines.' },
            { name: 'Semaphore', kind: CompletionItemKind.Class, detail: 'class asyncio.Semaphore(value: int = 1)', doc: 'A Semaphore implementation.' },
            { name: 'Lock', kind: CompletionItemKind.Class, detail: 'class asyncio.Lock()', doc: 'Primitive lock objects for asyncio tasks.' },
        ],
    },
    json: {
        doc: 'JSON encoder and decoder.',
        exports: [
            { name: 'dumps', kind: CompletionItemKind.Function, detail: 'json.dumps(obj: Any, *, indent: int | None = None, ensure_ascii: bool = True, default: Callable | None = None) -> str', doc: 'Serialize `obj` to a JSON formatted `str`.' },
            { name: 'loads', kind: CompletionItemKind.Function, detail: 'json.loads(s: str | bytes) -> Any', doc: 'Deserialize `s` (a `str`, `bytes` or `bytearray` instance containing a JSON document) to a Python object.' },
            { name: 'dump', kind: CompletionItemKind.Function, detail: 'json.dump(obj: Any, fp: IO[str], *, indent: int | None = None) -> None', doc: 'Serialize `obj` as a JSON formatted stream to `fp`.' },
            { name: 'load', kind: CompletionItemKind.Function, detail: 'json.load(fp: IO[str]) -> Any', doc: 'Deserialize `fp` to a Python object.' },
            { name: 'JSONDecodeError', kind: CompletionItemKind.Class, detail: 'class json.JSONDecodeError', doc: 'Subclass of `ValueError` raised when JSON decoding fails.' },
        ],
    },
    os: {
        doc: 'Miscellaneous operating system interfaces.',
        exports: [
            { name: 'environ', kind: CompletionItemKind.Variable, detail: 'os.environ: _Environ[str]', doc: 'A mapping object representing the string environment.' },
            { name: 'getenv', kind: CompletionItemKind.Function, detail: 'os.getenv(key: str, default: str | None = None) -> str | None', doc: 'Get an environment variable, return `None` if it doesn\'t exist.' },
            { name: 'getcwd', kind: CompletionItemKind.Function, detail: 'os.getcwd() -> str', doc: 'Return a unicode string representing the current working directory.' },
            { name: 'listdir', kind: CompletionItemKind.Function, detail: 'os.listdir(path: str | Path = ".") -> list[str]', doc: 'Return a list containing the names of the files in the directory.' },
            { name: 'makedirs', kind: CompletionItemKind.Function, detail: 'os.makedirs(name: str | Path, exist_ok: bool = False) -> None', doc: 'Super-mkdir; create a leaf directory and all intermediate ones.' },
            { name: 'remove', kind: CompletionItemKind.Function, detail: 'os.remove(path: str | Path) -> None', doc: 'Remove a file (same as `unlink()`).' },
            { name: 'path', kind: CompletionItemKind.Module, detail: 'module os.path', doc: 'Common operations on pathnames.' },
        ],
    },
    sys: {
        doc: 'System-specific parameters and functions.',
        exports: [
            { name: 'argv', kind: CompletionItemKind.Variable, detail: 'sys.argv: list[str]', doc: 'The list of command line arguments passed to a Python script.' },
            { name: 'exit', kind: CompletionItemKind.Function, detail: 'sys.exit(status: int | str | None = None) -> NoReturn', doc: 'Exit the interpreter by raising `SystemExit(status)`.' },
            { name: 'stdout', kind: CompletionItemKind.Variable, detail: 'sys.stdout: TextIO', doc: 'Standard output stream.' },
            { name: 'stderr', kind: CompletionItemKind.Variable, detail: 'sys.stderr: TextIO', doc: 'Standard error stream.' },
            { name: 'stdin', kind: CompletionItemKind.Variable, detail: 'sys.stdin: TextIO', doc: 'Standard input stream.' },
            { name: 'path', kind: CompletionItemKind.Variable, detail: 'sys.path: list[str]', doc: 'A list of strings that specifies the search path for modules.' },
            { name: 'version', kind: CompletionItemKind.Variable, detail: 'sys.version: str', doc: 'A string containing the version number of the Python interpreter.' },
        ],
    },
    re: {
        doc: 'Regular expression operations.',
        exports: [
            { name: 'search', kind: CompletionItemKind.Function, detail: 're.search(pattern: str, string: str, flags: int = 0) -> Match[str] | None', doc: 'Scan through string looking for the first location where the regular expression pattern produces a match.' },
            { name: 'match', kind: CompletionItemKind.Function, detail: 're.match(pattern: str, string: str, flags: int = 0) -> Match[str] | None', doc: 'Try to apply the pattern at the start of the string.' },
            { name: 'findall', kind: CompletionItemKind.Function, detail: 're.findall(pattern: str, string: str, flags: int = 0) -> list[Any]', doc: 'Return all non-overlapping matches of pattern in string, as a list of strings or tuples.' },
            { name: 'sub', kind: CompletionItemKind.Function, detail: 're.sub(pattern: str, repl: str | Callable, string: str, count: int = 0, flags: int = 0) -> str', doc: 'Return the string obtained by replacing the leftmost non-overlapping occurrences of pattern in string by repl.' },
            { name: 'split', kind: CompletionItemKind.Function, detail: 're.split(pattern: str, string: str, maxsplit: int = 0, flags: int = 0) -> list[str]', doc: 'Split the source string by the occurrences of the pattern.' },
            { name: 'compile', kind: CompletionItemKind.Function, detail: 're.compile(pattern: str, flags: int = 0) -> Pattern[str]', doc: 'Compile a regular expression pattern, returning a Pattern object.' },
            { name: 'IGNORECASE', kind: CompletionItemKind.Constant, detail: 're.IGNORECASE: RegexFlag', doc: 'Perform case-insensitive matching.' },
            { name: 'MULTILINE', kind: CompletionItemKind.Constant, detail: 're.MULTILINE: RegexFlag', doc: 'Make `^` and `$` match start/end of each line.' },
            { name: 'DOTALL', kind: CompletionItemKind.Constant, detail: 're.DOTALL: RegexFlag', doc: 'Make `.` match any character at all, including a newline.' },
        ],
    },
    pathlib: {
        doc: 'Object-oriented filesystem paths.',
        exports: [
            { name: 'Path', kind: CompletionItemKind.Class, detail: 'class pathlib.Path(*args: str | Path)', doc: 'PurePath subclass that can make system calls on path objects.' },
            { name: 'PurePath', kind: CompletionItemKind.Class, detail: 'class pathlib.PurePath(*args: str | Path)', doc: 'Base class for manipulating paths without I/O.' },
            { name: 'PurePosixPath', kind: CompletionItemKind.Class, detail: 'class pathlib.PurePosixPath(*args: str | Path)', doc: 'PurePath subclass for non-Windows systems.' },
            { name: 'PureWindowsPath', kind: CompletionItemKind.Class, detail: 'class pathlib.PureWindowsPath(*args: str | Path)', doc: 'PurePath subclass for Windows systems.' },
        ],
    },
    pydantic: {
        doc: 'Data validation and settings management using Python type annotations.',
        exports: [
            { name: 'BaseModel', kind: CompletionItemKind.Class, detail: 'class pydantic.BaseModel(**data: Any)', doc: 'Base class for creating Pydantic structured validation schemas.' },
            { name: 'Field', kind: CompletionItemKind.Function, detail: 'pydantic.Field(default: Any = ..., *, description: str | None = None, min_length: int | None = None, max_length: int | None = None, ge: float | None = None, le: float | None = None, gt: float | None = None, lt: float | None = None, pattern: str | None = None) -> Any', doc: 'Provide extra metadata and validation constraints for a Pydantic model field.' },
            { name: 'ConfigDict', kind: CompletionItemKind.Class, detail: 'class pydantic.ConfigDict', doc: 'A TypedDict for configuring Pydantic `BaseModel` behavior.' },
            { name: 'ValidationError', kind: CompletionItemKind.Class, detail: 'class pydantic.ValidationError', doc: 'Raised when Pydantic validation fails.' },
            { name: 'TypeAdapter', kind: CompletionItemKind.Class, detail: 'class pydantic.TypeAdapter(type: Any)', doc: 'TypeAdapter provides validation and serialization for arbitrary Python types.' },
            { name: 'field_validator', kind: CompletionItemKind.Function, detail: '@pydantic.field_validator(*fields: str, mode: str = "after")', doc: 'Decorate methods on the model to validate specific fields.' },
            { name: 'model_validator', kind: CompletionItemKind.Function, detail: '@pydantic.model_validator(*, mode: str)', doc: 'Decorate methods on the model to validate the entire model.' },
            { name: 'computed_field', kind: CompletionItemKind.Function, detail: '@pydantic.computed_field', doc: 'Decorator to include a `property` in `model_dump` and schema.' },
        ],
    },
    typing: {
        doc: 'Support for type hints.',
        exports: [
            { name: 'Any', kind: CompletionItemKind.Class, detail: 'typing.Any', doc: 'Special type indicating an unconstrained type.' },
            { name: 'Literal', kind: CompletionItemKind.Class, detail: 'typing.Literal[...]', doc: 'Special typing form to define literal value types (e.g. `Literal["low", "medium", "high"]`).' },
            { name: 'Optional', kind: CompletionItemKind.Class, detail: 'typing.Optional[T]', doc: 'Optional type (`T | None`).' },
            { name: 'Union', kind: CompletionItemKind.Class, detail: 'typing.Union[T1, T2, ...]', doc: 'Union type (`T1 | T2`).' },
            { name: 'Sequence', kind: CompletionItemKind.Class, detail: 'typing.Sequence[T]', doc: 'Generic read-only sequence type.' },
            { name: 'Mapping', kind: CompletionItemKind.Class, detail: 'typing.Mapping[K, V]', doc: 'Generic read-only mapping type.' },
            { name: 'Iterable', kind: CompletionItemKind.Class, detail: 'typing.Iterable[T]', doc: 'Generic iterable type.' },
            { name: 'Iterator', kind: CompletionItemKind.Class, detail: 'typing.Iterator[T]', doc: 'Generic iterator type.' },
            { name: 'Callable', kind: CompletionItemKind.Class, detail: 'typing.Callable[[ArgType], ReturnType]', doc: 'Callable type.' },
            { name: 'TypedDict', kind: CompletionItemKind.Class, detail: 'class typing.TypedDict', doc: 'Dictionary type with a fixed set of typed keys.' },
            { name: 'Annotated', kind: CompletionItemKind.Class, detail: 'typing.Annotated[T, ...]', doc: 'Add context-specific metadata to a type.' },
            { name: 'Final', kind: CompletionItemKind.Class, detail: 'typing.Final[T]', doc: 'Special typing construct to indicate final names.' },
            { name: 'ClassVar', kind: CompletionItemKind.Class, detail: 'typing.ClassVar[T]', doc: 'Special type construct to mark class variables.' },
            { name: 'Self', kind: CompletionItemKind.Class, detail: 'typing.Self', doc: 'Used to spell the type of "self" in classes.' },
            { name: 'TypeVar', kind: CompletionItemKind.Class, detail: 'typing.TypeVar(name: str, ...)', doc: 'Type variable for generic functions and classes.' },
            { name: 'Generic', kind: CompletionItemKind.Class, detail: 'typing.Generic[T]', doc: 'Abstract base class for generic types.' },
            { name: 'Protocol', kind: CompletionItemKind.Class, detail: 'class typing.Protocol', doc: 'Base class for protocol classes (structural subtyping).' },
            { name: 'List', kind: CompletionItemKind.Class, detail: 'typing.List[T]', doc: 'Deprecated alias to `builtins.list`.' },
            { name: 'Dict', kind: CompletionItemKind.Class, detail: 'typing.Dict[K, V]', doc: 'Deprecated alias to `builtins.dict`.' },
            { name: 'Set', kind: CompletionItemKind.Class, detail: 'typing.Set[T]', doc: 'Deprecated alias to `builtins.set`.' },
            { name: 'Tuple', kind: CompletionItemKind.Class, detail: 'typing.Tuple[...]', doc: 'Deprecated alias to `builtins.tuple`.' },
            { name: 'cast', kind: CompletionItemKind.Function, detail: 'typing.cast(typ: type[T], val: Any) -> T', doc: 'Cast a value to a type.' },
            { name: 'overload', kind: CompletionItemKind.Function, detail: '@typing.overload', doc: 'Decorator for overloaded functions/methods.' },
            { name: 'TYPE_CHECKING', kind: CompletionItemKind.Constant, detail: 'typing.TYPE_CHECKING: bool', doc: 'True when a static type checker is running, False at runtime.' },
        ],
    },
    dataclasses: {
        doc: 'Data Classes decorator and functions.',
        exports: [
            { name: 'dataclass', kind: CompletionItemKind.Function, detail: '@dataclasses.dataclass', doc: 'Decorator that adds generated special methods (`__init__`, `__repr__`, `__eq__`) to classes.' },
            { name: 'field', kind: CompletionItemKind.Function, detail: 'dataclasses.field(*, default=..., default_factory=..., repr=True)', doc: 'Return an object to identify dataclass fields.' },
            { name: 'asdict', kind: CompletionItemKind.Function, detail: 'dataclasses.asdict(obj: Any) -> dict[str, Any]', doc: 'Return the fields of a dataclass instance as a new dictionary.' },
            { name: 'astuple', kind: CompletionItemKind.Function, detail: 'dataclasses.astuple(obj: Any) -> tuple[Any, ...]', doc: 'Return the fields of a dataclass instance as a new tuple.' },
            { name: 'replace', kind: CompletionItemKind.Function, detail: 'dataclasses.replace(obj: T, **changes: Any) -> T', doc: 'Return a new object replacing specified fields with new values.' },
        ],
    },
    collections: {
        doc: 'Container datatypes.',
        exports: [
            { name: 'defaultdict', kind: CompletionItemKind.Class, detail: 'class collections.defaultdict(default_factory=...)', doc: 'Dict subclass that calls a factory function to supply missing values.' },
            { name: 'Counter', kind: CompletionItemKind.Class, detail: 'class collections.Counter(iterable=...)', doc: 'Dict subclass for counting hashable items.' },
            { name: 'deque', kind: CompletionItemKind.Class, detail: 'class collections.deque(iterable=(), maxlen=None)', doc: 'List-like container with fast appends and pops on either end.' },
            { name: 'OrderedDict', kind: CompletionItemKind.Class, detail: 'class collections.OrderedDict', doc: 'Dictionary that remembers insertion order.' },
            { name: 'namedtuple', kind: CompletionItemKind.Function, detail: 'collections.namedtuple(typename: str, field_names: Iterable[str])', doc: 'Returns a new subclass of tuple with named fields.' },
        ],
    },
    datetime: {
        doc: 'Basic date and time types.',
        exports: [
            { name: 'datetime', kind: CompletionItemKind.Class, detail: 'class datetime.datetime(year, month, day, hour=0, minute=0, second=0)', doc: 'A combination of a date and a time.' },
            { name: 'date', kind: CompletionItemKind.Class, detail: 'class datetime.date(year, month, day)', doc: 'Idealized naive date.' },
            { name: 'time', kind: CompletionItemKind.Class, detail: 'class datetime.time(hour=0, minute=0, second=0)', doc: 'An idealized time, independent of any particular day.' },
            { name: 'timedelta', kind: CompletionItemKind.Class, detail: 'class datetime.timedelta(days=0, seconds=0, minutes=0, hours=0, weeks=0)', doc: 'Difference between two datetime values.' },
            { name: 'timezone', kind: CompletionItemKind.Class, detail: 'class datetime.timezone', doc: 'Fixed offset from UTC implementation of tzinfo.' },
            { name: 'UTC', kind: CompletionItemKind.Constant, detail: 'datetime.UTC: timezone', doc: 'The UTC timezone singleton.' },
        ],
    },
    enum: {
        doc: 'Support for enumerations.',
        exports: [
            { name: 'Enum', kind: CompletionItemKind.Class, detail: 'class enum.Enum', doc: 'Base class for creating enumerated constants.' },
            { name: 'IntEnum', kind: CompletionItemKind.Class, detail: 'class enum.IntEnum', doc: 'Base class for creating enumerated constants that are also subclasses of `int`.' },
            { name: 'StrEnum', kind: CompletionItemKind.Class, detail: 'class enum.StrEnum', doc: 'Base class for creating enumerated constants that are also subclasses of `str`.' },
            { name: 'auto', kind: CompletionItemKind.Function, detail: 'enum.auto()', doc: 'Instances are replaced with an appropriate value in Enum class suites.' },
        ],
    },
    functools: {
        doc: 'Higher-order functions and operations on callable objects.',
        exports: [
            { name: 'lru_cache', kind: CompletionItemKind.Function, detail: '@functools.lru_cache(maxsize: int | None = 128)', doc: 'Least-recently-used cache decorator.' },
            { name: 'cache', kind: CompletionItemKind.Function, detail: '@functools.cache', doc: 'Simple lightweight unbounded function cache.' },
            { name: 'partial', kind: CompletionItemKind.Function, detail: 'functools.partial(func: Callable, *args: Any, **keywords: Any)', doc: 'New function with partial application of the given arguments and keywords.' },
            { name: 'reduce', kind: CompletionItemKind.Function, detail: 'functools.reduce(function: Callable, iterable: Iterable, initial: Any = ...)', doc: 'Apply a function of two arguments cumulatively to the items of a sequence.' },
            { name: 'wraps', kind: CompletionItemKind.Function, detail: '@functools.wraps(wrapped: Callable)', doc: 'Decorator to update a wrapper function to look like the wrapped function.' },
        ],
    },
    itertools: {
        doc: 'Functions creating iterators for efficient looping.',
        exports: [
            { name: 'chain', kind: CompletionItemKind.Function, detail: 'itertools.chain(*iterables: Iterable[T]) -> Iterator[T]', doc: 'Return a chain object whose `__next__()` method returns elements from the first iterable until it is exhausted, then elements from the next.' },
            { name: 'groupby', kind: CompletionItemKind.Function, detail: 'itertools.groupby(iterable: Iterable[T], key: Callable | None = None)', doc: 'Make an iterator that returns consecutive keys and groups from the iterable.' },
            { name: 'islice', kind: CompletionItemKind.Function, detail: 'itertools.islice(iterable: Iterable[T], stop: int | None)', doc: 'Make an iterator that returns selected elements from the iterable.' },
            { name: 'product', kind: CompletionItemKind.Function, detail: 'itertools.product(*iterables: Iterable, repeat: int = 1)', doc: 'Cartesian product of input iterables.' },
            { name: 'combinations', kind: CompletionItemKind.Function, detail: 'itertools.combinations(iterable: Iterable[T], r: int)', doc: 'Return successive r-length combinations of elements in the iterable.' },
            { name: 'permutations', kind: CompletionItemKind.Function, detail: 'itertools.permutations(iterable: Iterable[T], r: int | None = None)', doc: 'Return successive r-length permutations of elements in the iterable.' },
        ],
    },
    contextlib: {
        doc: 'Utilities for `with`-statement contexts.',
        exports: [
            { name: 'contextmanager', kind: CompletionItemKind.Function, detail: '@contextlib.contextmanager', doc: 'Decorator for generator-based context managers.' },
            { name: 'asynccontextmanager', kind: CompletionItemKind.Function, detail: '@contextlib.asynccontextmanager', doc: 'Decorator for async generator-based context managers.' },
            { name: 'suppress', kind: CompletionItemKind.Class, detail: 'contextlib.suppress(*exceptions: type[BaseException])', doc: 'Context manager to suppress specified exceptions.' },
        ],
    },
    math: {
        doc: 'Mathematical functions.',
        exports: [
            { name: 'sqrt', kind: CompletionItemKind.Function, detail: 'math.sqrt(x: float) -> float', doc: 'Return the square root of `x`.' },
            { name: 'ceil', kind: CompletionItemKind.Function, detail: 'math.ceil(x: float) -> int', doc: 'Return the ceiling of `x` as an Integral.' },
            { name: 'floor', kind: CompletionItemKind.Function, detail: 'math.floor(x: float) -> int', doc: 'Return the floor of `x` as an Integral.' },
            { name: 'log', kind: CompletionItemKind.Function, detail: 'math.log(x: float, base: float = math.e) -> float', doc: 'Return the logarithm of `x` to the given base.' },
            { name: 'pi', kind: CompletionItemKind.Constant, detail: 'math.pi: float = 3.141592653589793', doc: 'The mathematical constant π.' },
            { name: 'inf', kind: CompletionItemKind.Constant, detail: 'math.inf: float', doc: 'Floating-point positive infinity.' },
            { name: 'nan', kind: CompletionItemKind.Constant, detail: 'math.nan: float', doc: 'Floating-point "not a number" (NaN) value.' },
        ],
    },
    subprocess: {
        doc: 'Subprocess management.',
        exports: [
            { name: 'run', kind: CompletionItemKind.Function, detail: 'subprocess.run(args: Sequence[str] | str, *, capture_output: bool = False, text: bool = False, check: bool = False) -> CompletedProcess', doc: 'Run command with arguments and return a `CompletedProcess` instance.' },
            { name: 'CalledProcessError', kind: CompletionItemKind.Class, detail: 'class subprocess.CalledProcessError', doc: 'Raised when a process run by `check_call()` or `check_output()` returns a non-zero exit status.' },
        ],
    },
    shutil: {
        doc: 'High-level file operations.',
        exports: [
            { name: 'copy', kind: CompletionItemKind.Function, detail: 'shutil.copy(src: str | Path, dst: str | Path) -> str', doc: 'Copy data and mode bits ("cp src dst").' },
            { name: 'copytree', kind: CompletionItemKind.Function, detail: 'shutil.copytree(src: str | Path, dst: str | Path, dirs_exist_ok: bool = False)', doc: 'Recursively copy an entire directory tree.' },
            { name: 'rmtree', kind: CompletionItemKind.Function, detail: 'shutil.rmtree(path: str | Path, ignore_errors: bool = False)', doc: 'Recursively delete a directory tree.' },
            { name: 'which', kind: CompletionItemKind.Function, detail: 'shutil.which(cmd: str) -> str | None', doc: 'Return the path to an executable which would be run if the given cmd was called.' },
        ],
    },
    tempfile: {
        doc: 'Generate temporary files and directories.',
        exports: [
            { name: 'TemporaryDirectory', kind: CompletionItemKind.Class, detail: 'class tempfile.TemporaryDirectory()', doc: 'Create and return a temporary directory context manager.' },
            { name: 'NamedTemporaryFile', kind: CompletionItemKind.Function, detail: 'tempfile.NamedTemporaryFile(mode="w+b", delete=True)', doc: 'Create and return a temporary file with a visible name.' },
        ],
    },
    time: {
        doc: 'Time access and conversions.',
        exports: [
            { name: 'time', kind: CompletionItemKind.Function, detail: 'time.time() -> float', doc: 'Return the current time in seconds since the Epoch.' },
            { name: 'monotonic', kind: CompletionItemKind.Function, detail: 'time.monotonic() -> float', doc: 'Monotonic clock, cannot go backward.' },
            { name: 'sleep', kind: CompletionItemKind.Function, detail: 'time.sleep(seconds: float) -> None', doc: 'Delay execution for a given number of seconds.' },
        ],
    },
    uuid: {
        doc: 'UUID objects according to RFC 4122.',
        exports: [
            { name: 'uuid4', kind: CompletionItemKind.Function, detail: 'uuid.uuid4() -> UUID', doc: 'Generate a random UUID.' },
            { name: 'UUID', kind: CompletionItemKind.Class, detail: 'class uuid.UUID(hex: str)', doc: 'Instances of the UUID class represent UUIDs.' },
        ],
    },
    hashlib: {
        doc: 'Secure hashes and message digests.',
        exports: [
            { name: 'sha256', kind: CompletionItemKind.Function, detail: 'hashlib.sha256(data: bytes = b"") -> _Hash', doc: 'Return a new SHA-256 hash object.' },
            { name: 'md5', kind: CompletionItemKind.Function, detail: 'hashlib.md5(data: bytes = b"") -> _Hash', doc: 'Return a new MD5 hash object.' },
        ],
    },
    logging: {
        doc: 'Logging facility for Python.',
        exports: [
            { name: 'getLogger', kind: CompletionItemKind.Function, detail: 'logging.getLogger(name: str | None = None) -> Logger', doc: 'Return a logger with the specified name.' },
            { name: 'basicConfig', kind: CompletionItemKind.Function, detail: 'logging.basicConfig(**kwargs: Any) -> None', doc: 'Do basic configuration for the logging system.' },
            { name: 'info', kind: CompletionItemKind.Function, detail: 'logging.info(msg: object, *args: object) -> None', doc: 'Log a message with severity INFO on the root logger.' },
            { name: 'warning', kind: CompletionItemKind.Function, detail: 'logging.warning(msg: object, *args: object) -> None', doc: 'Log a message with severity WARNING on the root logger.' },
            { name: 'error', kind: CompletionItemKind.Function, detail: 'logging.error(msg: object, *args: object) -> None', doc: 'Log a message with severity ERROR on the root logger.' },
        ],
    },
    random: {
        doc: 'Generate pseudo-random numbers.',
        exports: [
            { name: 'randint', kind: CompletionItemKind.Function, detail: 'random.randint(a: int, b: int) -> int', doc: 'Return random integer in range `[a, b]`, including both end points.' },
            { name: 'choice', kind: CompletionItemKind.Function, detail: 'random.choice(seq: Sequence[T]) -> T', doc: 'Choose a random element from a non-empty sequence.' },
            { name: 'random', kind: CompletionItemKind.Function, detail: 'random.random() -> float', doc: 'Return the next random floating-point number in the range `[0.0, 1.0)`.' },
            { name: 'shuffle', kind: CompletionItemKind.Function, detail: 'random.shuffle(x: MutableSequence) -> None', doc: 'Shuffle list `x` in place, and return `None`.' },
        ],
    },
    spl2: {
        doc: 'Semantic Prompt Language v2 runtime and built-in tools.',
        exports: [
            { name: 'tools', kind: CompletionItemKind.Module, detail: 'module spl2.tools', doc: 'SPL2 built-in tools (`read_file`, `write_file`, `shell`, `web_fetch`, `web_search`).' },
            { name: 'runtime', kind: CompletionItemKind.Module, detail: 'module spl2.runtime', doc: 'SPL2 execution runtime.' },
        ],
    },
    'spl2.tools': {
        doc: 'SPL2 built-in tools.',
        exports: [
            { name: 'read_file', kind: CompletionItemKind.Function, detail: 'read_file(path: str | Path) -> str', doc: 'Reads UTF-8 file contents from the workspace.' },
            { name: 'write_file', kind: CompletionItemKind.Function, detail: 'write_file(path: str | Path, content: str) -> str', doc: 'Writes UTF-8 content to a file.' },
            { name: 'shell', kind: CompletionItemKind.Function, detail: 'shell(command: str) -> str', doc: 'Executes a shell command in the platform default shell.' },
            { name: 'web_fetch', kind: CompletionItemKind.Function, detail: 'web_fetch(url: str) -> str', doc: 'Fetches HTTP(S) content from a URL.' },
            { name: 'web_search', kind: CompletionItemKind.Function, detail: 'web_search(query: str) -> list[dict[str, str]]', doc: 'Performs a web search returning `[{title, url, snippet}]`.' },
        ],
    },
};

export interface PyToken {
    type: 'NAME' | 'NUMBER' | 'STRING' | 'OP';
    value: string;
    line: number; // 0-based line
    col: number; // 0-based gen col
    endLine: number;
    endCol: number;
}

interface LogicalLine {
    indent: number;
    startLine: number;
    endLine: number;
    tokens: PyToken[];
}

function mapOrigCol(lineAnchors: Map<number, ColumnAnchor[]>, line0: number, genCol: number): number {
    const anchors = lineAnchors.get(line0);
    if (!anchors || anchors.length === 0) return Math.max(0, genCol);
    let bestGen = 0;
    let bestOrig = 0;
    for (const a of anchors) {
        if (a.genCol <= genCol) {
            bestGen = a.genCol;
            bestOrig = a.origCol;
        } else {
            break;
        }
    }
    return Math.max(0, bestOrig + (genCol - bestGen));
}

function makeDiag(
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    line0: number,
    genColStart: number,
    genColEnd: number,
    message: string,
    code = 'syntax',
): Diagnostic {
    const origLineText = originalLines[line0] ?? '';
    const origStart = Math.min(origLineText.length, mapOrigCol(lineAnchors, line0, genColStart));
    const rawEnd = mapOrigCol(lineAnchors, line0, Math.max(genColStart + 1, genColEnd));
    const origEnd = Math.min(origLineText.length, Math.max(origStart + 1, rawEnd));
    return {
        severity: DiagnosticSeverity.Error,
        range: Range.create(line0, origStart, line0, origEnd),
        message,
        source: 'spl2',
        code,
    };
}

/**
 * Tokenizes a range of preprocessed Python lines (`startLine0` to `endLine0` inclusive)
 * into logical lines while validating string literals, f-string interpolations,
 * numeric literals, invalid characters, and balanced `()`, `[]`, `{}`.
 */
export function tokenizePythonBlock(
    outLines: string[],
    originalLines: string[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    startLine0: number,
    endLine0: number,
    pushDiag: (d: Diagnostic) => void,
): { logicalLines: LogicalLine[]; fstringExprTokens: PyToken[][] } {
    const allTokens: PyToken[] = [];
    const fstringExprTokens: PyToken[][] = [];
    const bracketStack: { char: '(' | '[' | '{'; line: number; col: number }[] = [];
    const logicalLines: LogicalLine[] = [];

    let curLogicalTokens: PyToken[] = [];
    let curLogicalIndent = 0;
    let curLogicalStartLine = startLine0;

    const flushLogicalLine = (endL: number) => {
        if (curLogicalTokens.length > 0) {
            logicalLines.push({
                indent: curLogicalIndent,
                startLine: curLogicalStartLine,
                endLine: endL,
                tokens: curLogicalTokens,
            });
            curLogicalTokens = [];
        }
    };

    let lineIdx = startLine0;
    while (lineIdx <= endLine0) {
        let line = outLines[lineIdx] ?? '';
        let i = 0;

        // Skip leading whitespace
        while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
            i++;
        }

        if (curLogicalTokens.length === 0 && bracketStack.length === 0) {
            curLogicalIndent = i;
            curLogicalStartLine = lineIdx;
        }

        let explicitContinuation = false;

        while (i < line.length) {
            const ch = line[i];

            if (ch === ' ' || ch === '\t' || ch === '\r') {
                i++;
                continue;
            }

            // Comment
            if (ch === '#') {
                break;
            }

            // Line continuation backslash
            if (ch === '\\') {
                const rest = line.slice(i + 1).trim();
                if (rest.length > 0) {
                    pushDiag(
                        makeDiag(
                            lineAnchors,
                            originalLines,
                            lineIdx,
                            i,
                            i + 2,
                            'SyntaxError: unexpected character after line continuation character',
                        ),
                    );
                } else {
                    explicitContinuation = true;
                }
                break;
            }

            // String literal (with optional prefix r, u, b, f, t, fr, rf, br, rb)
            const strPrefixMatch = /^([rRuUbBfFtT]{0,2})('''|"""|'|"|)/.exec(line.slice(i));
            if (strPrefixMatch && strPrefixMatch[2]) {
                const prefix = strPrefixMatch[1];
                const quote = strPrefixMatch[2];
                const prefixLower = prefix.toLowerCase();
                // Validate prefix combinations
                if (
                    prefixLower.length === 2 &&
                    !['fr', 'rf', 'br', 'rb', 'tr', 'rt'].includes(prefixLower)
                ) {
                    pushDiag(
                        makeDiag(
                            lineAnchors,
                            originalLines,
                            lineIdx,
                            i,
                            i + prefix.length + quote.length,
                            `SyntaxError: invalid string prefix '${prefix}'`,
                        ),
                    );
                }

                const isFString = prefixLower.includes('f');
                const tokStartLine = lineIdx;
                const tokStartCol = i;

                if (quote.length === 3) {
                    // Triple-quoted string (can span lines)
                    let curL = lineIdx;
                    let curC = i + prefix.length + 3;
                    let closed = false;
                    let rawContent = prefix + quote;

                    while (curL <= endLine0) {
                        const lText = outLines[curL] ?? '';
                        let foundClose = -1;
                        let scanC = curC;
                        while (scanC < lText.length) {
                            if (lText[scanC] === '\\') {
                                scanC += 2;
                                continue;
                            }
                            if (lText.startsWith(quote, scanC)) {
                                foundClose = scanC;
                                break;
                            }
                            scanC++;
                        }
                        if (foundClose >= 0) {
                            rawContent += lText.slice(curC, foundClose + 3);
                            const endC = foundClose + 3;
                            const tok: PyToken = {
                                type: 'STRING',
                                value: rawContent,
                                line: tokStartLine,
                                col: tokStartCol,
                                endLine: curL,
                                endCol: endC,
                            };
                            allTokens.push(tok);
                            curLogicalTokens.push(tok);
                            if (isFString) {
                                scanFStringInterpolations(
                                    outLines,
                                    originalLines,
                                    lineAnchors,
                                    tokStartLine,
                                    tokStartCol + prefix.length + 3,
                                    curL,
                                    foundClose,
                                    fstringExprTokens,
                                    pushDiag,
                                );
                            }
                            lineIdx = curL;
                            line = lText;
                            i = endC;
                            closed = true;
                            break;
                        } else {
                            rawContent += lText.slice(curC) + '\n';
                            curL++;
                            curC = 0;
                        }
                    }

                    if (!closed) {
                        pushDiag(
                            makeDiag(
                                lineAnchors,
                                originalLines,
                                tokStartLine,
                                tokStartCol,
                                tokStartCol + prefix.length + 3,
                                `SyntaxError: unterminated triple-quoted string literal (detected at line ${endLine0 + 1})`,
                            ),
                        );
                        lineIdx = endLine0 + 1;
                        break;
                    }
                    continue;
                } else {
                    // Single-line string literal (' or ")
                    let scanC = i + prefix.length + 1;
                    let fDepth = 0;
                    let foundClose = -1;
                    while (scanC < line.length) {
                        const c = line[scanC];
                        if (c === '\\') {
                            scanC += 2;
                            continue;
                        }
                        if (isFString) {
                            if (c === '{') {
                                if (line[scanC + 1] === '{' && fDepth === 0) {
                                    scanC += 2;
                                    continue;
                                }
                                fDepth++;
                                scanC++;
                                continue;
                            }
                            if (c === '}' && fDepth > 0) {
                                fDepth--;
                                scanC++;
                                continue;
                            }
                        }
                        if (c === quote && fDepth === 0) {
                            foundClose = scanC;
                            break;
                        }
                        scanC++;
                    }

                    if (foundClose < 0) {
                        pushDiag(
                            makeDiag(
                                lineAnchors,
                                originalLines,
                                lineIdx,
                                tokStartCol,
                                line.length,
                                'SyntaxError: unterminated string literal',
                            ),
                        );
                        i = line.length;
                        break;
                    }

                    const endC = foundClose + 1;
                    const rawVal = line.slice(tokStartCol, endC);
                    const tok: PyToken = {
                        type: 'STRING',
                        value: rawVal,
                        line: lineIdx,
                        col: tokStartCol,
                        endLine: lineIdx,
                        endCol: endC,
                    };
                    allTokens.push(tok);
                    curLogicalTokens.push(tok);
                    if (isFString) {
                        scanFStringInterpolations(
                            outLines,
                            originalLines,
                            lineAnchors,
                            lineIdx,
                            tokStartCol + prefix.length + 1,
                            lineIdx,
                            foundClose,
                            fstringExprTokens,
                            pushDiag,
                        );
                    }
                    i = endC;
                    continue;
                }
            }

            // Numbers
            if (/\d/.test(ch) || (ch === '.' && i + 1 < line.length && /\d/.test(line[i + 1]))) {
                const rest = line.slice(i);
                const numMatch =
                    /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*\.[\d_]*(?:[eE][+-]?[\d_]+)?[jJ]?|\.[\d_]+(?:[eE][+-]?[\d_]+)?[jJ]?|\d[\d_]*[eE][+-]?[\d_]+[jJ]?|\d[\d_]*[jJ]?)/.exec(
                        rest,
                    );
                if (numMatch) {
                    const numStr = numMatch[0];
                    const endC = i + numStr.length;
                    // Check if immediately followed by identifier character (e.g. `123abc` or `0x`)
                    if (endC < line.length && /[A-Za-z_]/.test(line[endC])) {
                        const badEnd = endC + (/^[A-Za-z0-9_]+/.exec(line.slice(endC))?.[0].length ?? 1);
                        pushDiag(
                            makeDiag(
                                lineAnchors,
                                originalLines,
                                lineIdx,
                                i,
                                badEnd,
                                'SyntaxError: invalid decimal literal',
                            ),
                        );
                        i = badEnd;
                        continue;
                    }
                    // Check leading zero on non-zero decimal int (e.g. `012`)
                    if (/^0[0-9_]+$/.test(numStr) && !/^0+$|^0_0+$/.test(numStr)) {
                        pushDiag(
                            makeDiag(
                                lineAnchors,
                                originalLines,
                                lineIdx,
                                i,
                                endC,
                                'SyntaxError: leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers',
                            ),
                        );
                    }
                    const tok: PyToken = {
                        type: 'NUMBER',
                        value: numStr,
                        line: lineIdx,
                        col: i,
                        endLine: lineIdx,
                        endCol: endC,
                    };
                    allTokens.push(tok);
                    curLogicalTokens.push(tok);
                    i = endC;
                    continue;
                }
            }

            // Identifiers / Keywords
            if (/[A-Za-z_\u0080-\uFFFF]/.test(ch)) {
                const idMatch = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*/.exec(line.slice(i))!;
                const idStr = idMatch[0];
                const endC = i + idStr.length;
                const tok: PyToken = {
                    type: 'NAME',
                    value: idStr,
                    line: lineIdx,
                    col: i,
                    endLine: lineIdx,
                    endCol: endC,
                };
                allTokens.push(tok);
                curLogicalTokens.push(tok);
                i = endC;
                continue;
            }

            // Operators and delimiters
            const opMatch =
                /^(?:\.\.\.|\/\/=|\*\*=|<<=|>>=|->|:=|==|!=|<=|>=|<<|>>|\/\/|\*\*|\+=|-=|\*=|\/=|%=|@=|&=|\|=|\^=|[()[\]{},:.;@=+\-*/%&|^~<>])/.exec(
                    line.slice(i),
                );
            if (opMatch) {
                const opStr = opMatch[0];
                const endC = i + opStr.length;
                if (opStr === '(' || opStr === '[' || opStr === '{') {
                    bracketStack.push({ char: opStr, line: lineIdx, col: i });
                } else if (opStr === ')' || opStr === ']' || opStr === '}') {
                    const expectedOpen = opStr === ')' ? '(' : opStr === ']' ? '[' : '{';
                    if (bracketStack.length === 0) {
                        pushDiag(
                            makeDiag(
                                lineAnchors,
                                originalLines,
                                lineIdx,
                                i,
                                endC,
                                `SyntaxError: unmatched '${opStr}'`,
                            ),
                        );
                    } else {
                        const top = bracketStack.pop()!;
                        if (top.char !== expectedOpen) {
                            pushDiag(
                                makeDiag(
                                    lineAnchors,
                                    originalLines,
                                    lineIdx,
                                    i,
                                    endC,
                                    `SyntaxError: closing parenthesis '${opStr}' does not match opening parenthesis '${top.char}'`,
                                ),
                            );
                        }
                    }
                }
                const tok: PyToken = {
                    type: 'OP',
                    value: opStr,
                    line: lineIdx,
                    col: i,
                    endLine: lineIdx,
                    endCol: endC,
                };
                allTokens.push(tok);
                curLogicalTokens.push(tok);
                i = endC;
                continue;
            }

            // Invalid character (e.g. $, ?, `)
            pushDiag(
                makeDiag(
                    lineAnchors,
                    originalLines,
                    lineIdx,
                    i,
                    i + 1,
                    `SyntaxError: invalid character '${ch}'`,
                ),
            );
            i++;
        }

        if (bracketStack.length === 0 && !explicitContinuation) {
            flushLogicalLine(lineIdx);
        }

        lineIdx++;
    }

    if (bracketStack.length > 0) {
        const unclosed = bracketStack[bracketStack.length - 1];
        pushDiag(
            makeDiag(
                lineAnchors,
                originalLines,
                unclosed.line,
                unclosed.col,
                unclosed.col + 1,
                `SyntaxError: '${unclosed.char}' was never closed`,
            ),
        );
        flushLogicalLine(endLine0);
    } else {
        flushLogicalLine(endLine0);
    }

    return { logicalLines, fstringExprTokens };
}

function scanFStringInterpolations(
    outLines: string[],
    originalLines: string[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    fstringExprTokens: PyToken[][],
    pushDiag: (d: Diagnostic) => void,
): void {
    const contentLines = outLines.slice(startLine, endLine + 1);
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const contentLine of contentLines) {
        lineOffsets.push(offset);
        offset += contentLine.length + 1;
    }
    const positionAt = (index: number) => {
        let row = 0;
        while (row + 1 < lineOffsets.length && lineOffsets[row + 1] <= index) row++;
        return { line: startLine + row, col: index - lineOffsets[row] };
    };
    const line = contentLines.join('\n');
    const contentEnd = lineOffsets[endLine - startLine] + endCol;
    let i = startCol;
    while (i < contentEnd) {
        const ch = line[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '{') {
            if (line[i + 1] === '{') {
                i += 2;
                continue;
            }
            const openCol = i;
            const openPos = positionAt(openCol);
            i++;
            let depth = 1;
            let inQuote: string | null = null;
            let exprEndCol = -1;
            let closeBraceCol = -1;

            while (i < contentEnd && depth > 0) {
                const c = line[i];
                if (inQuote) {
                    if (c === '\\') {
                        i += 2;
                        continue;
                    }
                    if (c === inQuote) inQuote = null;
                    i++;
                    continue;
                }
                if (c === "'" || c === '"') {
                    inQuote = c;
                    i++;
                    continue;
                }
                if (c === '(' || c === '[' || c === '{') {
                    depth++;
                    i++;
                    continue;
                }
                if (c === ')' || c === ']') {
                    depth = Math.max(1, depth - 1);
                    i++;
                    continue;
                }
                if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        closeBraceCol = i;
                        if (exprEndCol < 0) exprEndCol = i;
                        i++;
                        break;
                    }
                    i++;
                    continue;
                }
                // At depth === 1, check for format specifier `:` or conversion `!s`/`!r`/`!a`
                if (depth === 1 && exprEndCol < 0) {
                    if (c === ':' && line[i + 1] !== '=') {
                        exprEndCol = i;
                    } else if (c === '!' && line[i + 1] !== '=') {
                        exprEndCol = i;
                    }
                }
                i++;
            }

            if (closeBraceCol < 0) {
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        openPos.line,
                        openPos.col,
                        openPos.col + 1,
                        "SyntaxError: f-string: expecting '}'",
                    ),
                );
                return;
            }

            let exprSlice = line.slice(openCol + 1, exprEndCol);
            // Strip trailing `=` debug specifier if not `==`, `!=`, `<=`, `>=`, `:=`
            if (exprSlice.endsWith('=') && !/(?:[=!<>:])$/.test(exprSlice.slice(0, -1))) {
                exprSlice = exprSlice.slice(0, -1);
            }

            if (!exprSlice.trim()) {
                const closePos = positionAt(closeBraceCol);
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        openPos.line,
                        openPos.col,
                        closePos.line === openPos.line ? closePos.col + 1 : openPos.col + 1,
                        'SyntaxError: f-string: empty expression not allowed',
                    ),
                );
                continue;
            }

            // Tokenize the interpolation expression with exact column positions
            const exprStart = positionAt(openCol + 1);
            const exprLines = exprSlice.split('\n');
            exprLines[0] = ' '.repeat(exprStart.col) + exprLines[0];
            const subLines = [...outLines];
            exprLines.forEach((text, row) => {
                subLines[exprStart.line + row] = text;
            });
            const subRes = tokenizePythonBlock(
                subLines,
                originalLines,
                lineAnchors,
                exprStart.line,
                exprStart.line + exprLines.length - 1,
                pushDiag,
            );
            const exprTokens = subRes.logicalLines.flatMap((logicalLine) => logicalLine.tokens);
            if (exprTokens.length > 0) {
                validateExpressionTokens(exprTokens, false, false, lineAnchors, originalLines, pushDiag);
                fstringExprTokens.push(exprTokens);
            }
            fstringExprTokens.push(...subRes.fstringExprTokens);
            continue;
        }
        if (ch === '}') {
            if (line[i + 1] === '}') {
                i += 2;
                continue;
            }
            const pos = positionAt(i);
            pushDiag(
                makeDiag(
                    lineAnchors,
                    originalLines,
                    pos.line,
                    pos.col,
                    pos.col + 1,
                    "SyntaxError: f-string: single '}' is not allowed",
                ),
            );
            i++;
            continue;
        }
        i++;
    }
}

const BINARY_ONLY_OPS = new Set<string>([
    '/',
    '//',
    '%',
    '@',
    '<<',
    '>>',
    '&',
    '|',
    '^',
    '<',
    '>',
    '<=',
    '>=',
    '==',
    '!=',
    ':=',
]);

const ALL_BINARY_OPS = new Set<string>([
    '+',
    '-',
    '*',
    '**',
    ...BINARY_ONLY_OPS,
]);

const AUG_ASSIGN_OPS = new Set<string>([
    '+=',
    '-=',
    '*=',
    '/=',
    '//=',
    '%=',
    '**=',
    '&=',
    '|=',
    '^=',
    '<<=',
    '>>=',
    '@=',
]);

const STATEMENT_ONLY_KEYWORDS = new Set<string>([
    'assert',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'except',
    'finally',
    'from',
    'global',
    'import',
    'nonlocal',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
]);

function findMatchingCloser(tokens: PyToken[], openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'OP') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return tokens.length - 1;
}

/**
 * Validates that `tokens` form a syntactically valid Python assignment target
 * (identifier, attribute `a.b`, subscript `a[b]`, starred `*a`, or tuple/list of targets).
 */
function validateAssignmentTarget(
    tokens: PyToken[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    pushDiag: (d: Diagnostic) => void,
): boolean {
    if (tokens.length === 0) return false;

    // Split top-level commas
    const parts: PyToken[][] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'OP') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') depth = Math.max(0, depth - 1);
            else if (t.value === ',' && depth === 0) {
                parts.push(tokens.slice(start, i));
                start = i + 1;
            }
        }
    }
    if (start < tokens.length) {
        parts.push(tokens.slice(start));
    }

    if (parts.length > 1) {
        for (const p of parts) {
            if (p.length === 0) {
                const tok = tokens[0];
                pushDiag(makeDiag(lineAnchors, originalLines, tok.line, tok.col, tok.endCol, 'SyntaxError: invalid syntax'));
                return false;
            }
            if (!validateAssignmentTarget(p, lineAnchors, originalLines, pushDiag)) return false;
        }
        return true;
    }

    let cur = tokens;
    if (cur[0].type === 'OP' && cur[0].value === '*') {
        cur = cur.slice(1);
        if (cur.length === 0) {
            const tok = tokens[0];
            pushDiag(makeDiag(lineAnchors, originalLines, tok.line, tok.col, tok.endCol, 'SyntaxError: invalid syntax'));
            return false;
        }
    }

    // Parenthesized or list target: `(a, b) = ...` or `[a, b] = ...`
    if (
        cur[0].type === 'OP' &&
        (cur[0].value === '(' || cur[0].value === '[') &&
        findMatchingCloser(cur, 0) === cur.length - 1
    ) {
        const inner = cur.slice(1, -1);
        if (inner.length === 0) {
            pushDiag(makeDiag(lineAnchors, originalLines, cur[0].line, cur[0].col, cur[cur.length - 1].endCol, 'SyntaxError: cannot assign to ()'));
            return false;
        }
        return validateAssignmentTarget(inner, lineAnchors, originalLines, pushDiag);
    }

    // Primary target: must start with NAME (not a hard keyword like True/False/None/def/etc.)
    // followed by zero or more `.attr` or `[subscript]`, ending with identifier or `[subscript]` (NOT a call `()`!).
    if (cur[0].type !== 'NAME' || HARD_KEYWORDS.has(cur[0].value)) {
        const first = cur[0];
        const msg =
            first.type === 'NUMBER' || first.type === 'STRING' || ['True', 'False', 'None'].includes(first.value)
                ? 'SyntaxError: cannot assign to literal'
                : 'SyntaxError: cannot assign to expression';
        pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, cur[cur.length - 1].endCol, msg));
        return false;
    }

    let idx = 1;
    let lastWasCall = false;
    while (idx < cur.length) {
        const t = cur[idx];
        if (t.type === 'OP' && t.value === '.') {
            if (idx + 1 >= cur.length || cur[idx + 1].type !== 'NAME' || HARD_KEYWORDS.has(cur[idx + 1].value)) {
                pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                return false;
            }
            lastWasCall = false;
            idx += 2;
            continue;
        }
        if (t.type === 'OP' && t.value === '[') {
            const closeIdx = findMatchingCloser(cur, idx);
            const inner = cur.slice(idx + 1, closeIdx);
            if (inner.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, cur[closeIdx].endCol, 'SyntaxError: invalid syntax'));
                return false;
            }
            validateExpressionTokens(inner, true, false, lineAnchors, originalLines, pushDiag);
            lastWasCall = false;
            idx = closeIdx + 1;
            continue;
        }
        if (t.type === 'OP' && t.value === '(') {
            const closeIdx = findMatchingCloser(cur, idx);
            lastWasCall = true;
            idx = closeIdx + 1;
            continue;
        }
        // Any binary operator or unexpected token on LHS of `=`
        pushDiag(
            makeDiag(
                lineAnchors,
                originalLines,
                cur[0].line,
                cur[0].col,
                cur[cur.length - 1].endCol,
                'SyntaxError: cannot assign to expression',
            ),
        );
        return false;
    }

    if (lastWasCall) {
        pushDiag(
            makeDiag(
                lineAnchors,
                originalLines,
                cur[0].line,
                cur[0].col,
                cur[cur.length - 1].endCol,
                'SyntaxError: cannot assign to function call',
            ),
        );
        return false;
    }

    return true;
}

/**
 * Validates that `tokens` form a syntactically valid Python expression (or comma-separated /
 * slice / dict / call argument list).
 */
function validateExpressionTokens(
    tokens: PyToken[],
    allowSlices: boolean,
    allowDictColon: boolean,
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    pushDiag: (d: Diagnostic) => void,
    isCallArgs = false,
): void {
    if (tokens.length === 0) return;

    let expectOperand = true;
    let inComprehension = false;
    let pendingTernaryIf: PyToken | null = null;
    let i = 0;

    while (i < tokens.length) {
        const t = tokens[i];

        if (expectOperand) {
            // Prefix unary operators: +, -, ~, *, **
            if (t.type === 'OP' && (t.value === '+' || t.value === '-' || t.value === '~' || t.value === '*' || t.value === '**')) {
                i++;
                continue;
            }
            // Prefix keyword operators: not, await, yield
            if (t.type === 'NAME' && (t.value === 'not' || t.value === 'await' || t.value === 'yield')) {
                if (t.value === 'yield' && i + 1 < tokens.length && tokens[i + 1].type === 'NAME' && tokens[i + 1].value === 'from') {
                    i += 2;
                    continue;
                }
                i++;
                continue;
            }
            // Lambda expression: `lambda [params]: body`
            if (t.type === 'NAME' && t.value === 'lambda') {
                let colonIdx = -1;
                let depth = 0;
                for (let k = i + 1; k < tokens.length; k++) {
                    if (tokens[k].type === 'OP') {
                        if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                        else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                        else if (tokens[k].value === ':' && depth === 0) {
                            colonIdx = k;
                            break;
                        }
                    }
                }
                if (colonIdx < 0) {
                    const last = tokens[tokens.length - 1];
                    pushDiag(makeDiag(lineAnchors, originalLines, last.line, last.col, last.endCol, "SyntaxError: expected ':'"));
                    return;
                }
                if (colonIdx + 1 >= tokens.length) {
                    const colTok = tokens[colonIdx];
                    pushDiag(makeDiag(lineAnchors, originalLines, colTok.line, colTok.col, colTok.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                i = colonIdx + 1;
                expectOperand = true;
                continue;
            }
            // Slice colon when operand is omitted: `arr[:2]`, `arr[::2]`, `arr[:]`
            if (allowSlices && t.type === 'OP' && t.value === ':') {
                i++;
                expectOperand = true;
                continue;
            }
            // Primary atoms: NUMBER, STRING, `...`
            if (t.type === 'NUMBER' || t.type === 'STRING' || (t.type === 'OP' && t.value === '...')) {
                expectOperand = false;
                i++;
                continue;
            }
            // Identifier or True / False / None
            if (t.type === 'NAME') {
                if (
                    STATEMENT_ONLY_KEYWORDS.has(t.value) ||
                    ['and', 'or', 'in', 'is', 'else', 'for', 'if', 'as'].includes(t.value)
                ) {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                // Check for keyword argument `name = expr` inside call `(...)`
                if (isCallArgs && i + 1 < tokens.length && tokens[i + 1].type === 'OP' && tokens[i + 1].value === '=') {
                    if (HARD_KEYWORDS.has(t.value)) {
                        pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                        return;
                    }
                    i += 2;
                    expectOperand = true;
                    continue;
                }
                expectOperand = false;
                i++;
                continue;
            }
            // Opening bracket `(`, `[`, `{`
            if (t.type === 'OP' && (t.value === '(' || t.value === '[' || t.value === '{')) {
                const closeIdx = findMatchingCloser(tokens, i);
                const inner = tokens.slice(i + 1, closeIdx);
                validateExpressionTokens(
                    inner,
                    false,
                    t.value === '{',
                    lineAnchors,
                    originalLines,
                    pushDiag,
                    false,
                );
                expectOperand = false;
                i = closeIdx + 1;
                continue;
            }

            // Anything else when expecting an operand is a syntax error
            pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
            return;
        } else {
            // expectOperand === false (just saw an operand)

            // 1. Attribute access `.name`
            if (t.type === 'OP' && t.value === '.') {
                if (i + 1 >= tokens.length) {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                const nextTok = tokens[i + 1];
                if (nextTok.type !== 'NAME' || HARD_KEYWORDS.has(nextTok.value)) {
                    pushDiag(makeDiag(lineAnchors, originalLines, nextTok.line, nextTok.col, nextTok.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                i += 2;
                expectOperand = false;
                continue;
            }

            // 2. Postfix call `(...)` or subscript `[...]`
            if (t.type === 'OP' && (t.value === '(' || t.value === '[')) {
                const prevTok = tokens[i - 1];
                if (prevTok.type === 'NUMBER') {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                const closeIdx = findMatchingCloser(tokens, i);
                const inner = tokens.slice(i + 1, closeIdx);
                if (t.value === '[' && inner.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, tokens[closeIdx].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                validateExpressionTokens(
                    inner,
                    t.value === '[',
                    false,
                    lineAnchors,
                    originalLines,
                    pushDiag,
                    t.value === '(',
                );
                i = closeIdx + 1;
                expectOperand = false;
                continue;
            }

            // 3. Binary operators
            if (t.type === 'OP' && ALL_BINARY_OPS.has(t.value)) {
                expectOperand = true;
                i++;
                continue;
            }

            // 4. Keyword binary operators: `and`, `or`, `in`, `not in`, `is`, `is not`
            if (t.type === 'NAME' && (t.value === 'and' || t.value === 'or' || t.value === 'in')) {
                expectOperand = true;
                i++;
                continue;
            }
            if (t.type === 'NAME' && t.value === 'is') {
                if (i + 1 < tokens.length && tokens[i + 1].type === 'NAME' && tokens[i + 1].value === 'not') {
                    i += 2;
                } else {
                    i++;
                }
                expectOperand = true;
                continue;
            }
            if (t.type === 'NAME' && t.value === 'not') {
                if (i + 1 < tokens.length && tokens[i + 1].type === 'NAME' && tokens[i + 1].value === 'in') {
                    i += 2;
                    expectOperand = true;
                    continue;
                }
                pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                return;
            }

            // 5. Comprehension `for <target> in <iter>` / `async for <target> in <iter>`
            if (
                t.type === 'NAME' &&
                (t.value === 'for' || (t.value === 'async' && i + 1 < tokens.length && tokens[i + 1].type === 'NAME' && tokens[i + 1].value === 'for'))
            ) {
                const forStart = t.value === 'async' ? i + 2 : i + 1;
                let inIdx = -1;
                let depth = 0;
                for (let k = forStart; k < tokens.length; k++) {
                    if (tokens[k].type === 'OP') {
                        if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                        else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                    } else if (tokens[k].type === 'NAME' && tokens[k].value === 'in' && depth === 0) {
                        inIdx = k;
                        break;
                    }
                }
                if (inIdx < 0 || inIdx === forStart) {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                const targetTokens = tokens.slice(forStart, inIdx);
                if (!validateAssignmentTarget(targetTokens, lineAnchors, originalLines, pushDiag)) {
                    return;
                }
                inComprehension = true;
                expectOperand = true;
                i = inIdx + 1;
                continue;
            }

            // 6. Ternary `if ... else ...` or comprehension `if ...`
            if (t.type === 'NAME' && t.value === 'if') {
                if (!inComprehension) {
                    pendingTernaryIf = t;
                }
                expectOperand = true;
                i++;
                continue;
            }
            if (t.type === 'NAME' && t.value === 'else') {
                if (!pendingTernaryIf) {
                    pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                pendingTernaryIf = null;
                expectOperand = true;
                i++;
                continue;
            }

            // 7. Comma `,`
            if (t.type === 'OP' && t.value === ',') {
                if (pendingTernaryIf) {
                    pushDiag(
                        makeDiag(
                            lineAnchors,
                            originalLines,
                            pendingTernaryIf.line,
                            pendingTernaryIf.col,
                            pendingTernaryIf.endCol,
                            "SyntaxError: expected 'else' after 'if' expression",
                        ),
                    );
                    return;
                }
                inComprehension = false;
                // Trailing comma at very end of token list is valid!
                if (i === tokens.length - 1) {
                    expectOperand = false;
                    i++;
                    continue;
                }
                // Check if next argument in call is `name = expr`
                expectOperand = true;
                i++;
                continue;
            }

            // 8. Colon `:` inside dict `{k: v}` or slice `arr[1:2]`
            if (t.type === 'OP' && t.value === ':' && (allowDictColon || allowSlices)) {
                expectOperand = true;
                i++;
                continue;
            }

            // 9. Adjacent string literal concatenation `'a' 'b'`
            if (t.type === 'STRING' && tokens[i - 1].type === 'STRING') {
                expectOperand = false;
                i++;
                continue;
            }

            // Anything else (e.g. two adjacent identifiers `foo bar`, `foo 'bar'`, `1 2`) is a syntax error
            pushDiag(makeDiag(lineAnchors, originalLines, t.line, t.col, t.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
    }

    if (expectOperand) {
        const last = tokens[tokens.length - 1];
        // In a slice `arr[1:]` or `arr[:]`, ending right after `:` is valid!
        if (allowSlices && last.type === 'OP' && last.value === ':') {
            return;
        }
        pushDiag(makeDiag(lineAnchors, originalLines, last.line, last.col, last.endCol, 'SyntaxError: invalid syntax'));
        return;
    }

    if (pendingTernaryIf) {
        pushDiag(
            makeDiag(
                lineAnchors,
                originalLines,
                pendingTernaryIf.line,
                pendingTernaryIf.col,
                pendingTernaryIf.endCol,
                "SyntaxError: expected 'else' after 'if' expression",
            ),
        );
    }
}

function splitTopLevel(tokens: PyToken[], sepOp: string): PyToken[][] {
    const res: PyToken[][] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'OP') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') depth = Math.max(0, depth - 1);
            else if (t.value === sepOp && depth === 0) {
                res.push(tokens.slice(start, i));
                start = i + 1;
            }
        }
    }
    res.push(tokens.slice(start));
    return res;
}

function findTopLevelHeaderColon(tokens: PyToken[]): number {
    let depth = 0;
    let inLambda = false;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'OP') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') depth = Math.max(0, depth - 1);
            else if (t.value === ':' && depth === 0) {
                if (inLambda) {
                    inLambda = false;
                    continue;
                }
                return i;
            }
        } else if (t.type === 'NAME' && t.value === 'lambda' && depth === 0) {
            inLambda = true;
        }
    }
    return -1;
}

function extractTargetBindingsAndLoads(
    tokens: PyToken[],
    boundNames: Set<string>,
    loadTokens: PyToken[],
): void {
    const parts = splitTopLevel(tokens, ',');
    if (parts.length > 1) {
        for (const p of parts) {
            if (p.length > 0) extractTargetBindingsAndLoads(p, boundNames, loadTokens);
        }
        return;
    }
    let cur = tokens;
    if (cur.length > 0 && cur[0].type === 'OP' && cur[0].value === '*') {
        cur = cur.slice(1);
    }
    if (
        cur.length >= 2 &&
        cur[0].type === 'OP' &&
        (cur[0].value === '(' || cur[0].value === '[') &&
        findMatchingCloser(cur, 0) === cur.length - 1
    ) {
        extractTargetBindingsAndLoads(cur.slice(1, -1), boundNames, loadTokens);
        return;
    }
    if (cur.length === 1 && cur[0].type === 'NAME' && !HARD_KEYWORDS.has(cur[0].value)) {
        boundNames.add(cur[0].value);
        return;
    }
    // Attribute `obj.attr = ...` or subscript `arr[idx] = ...`: `obj`, `arr`, `idx` are loads
    extractExpressionLoads(cur, boundNames, loadTokens);
}

function extractExpressionLoads(
    tokens: PyToken[],
    boundNames: Set<string>,
    loadTokens: PyToken[],
): void {
    if (tokens.length === 0) return;

    // Pre-scan for inline comprehension `for <target> in`, `lambda <params>:`, and walrus `<name> :=`
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'NAME' && t.value === 'for') {
            let inIdx = -1;
            let depth = 0;
            for (let k = i + 1; k < tokens.length; k++) {
                if (tokens[k].type === 'OP') {
                    if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                    else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                } else if (tokens[k].type === 'NAME' && tokens[k].value === 'in' && depth === 0) {
                    inIdx = k;
                    break;
                }
            }
            if (inIdx > i + 1) {
                for (let k = i + 1; k < inIdx; k++) {
                    if (tokens[k].type === 'NAME' && !HARD_KEYWORDS.has(tokens[k].value)) {
                        boundNames.add(tokens[k].value);
                    }
                }
            }
        } else if (t.type === 'NAME' && t.value === 'lambda') {
            let colonIdx = -1;
            let depth = 0;
            for (let k = i + 1; k < tokens.length; k++) {
                if (tokens[k].type === 'OP') {
                    if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                    else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                    else if (tokens[k].value === ':' && depth === 0) {
                        colonIdx = k;
                        break;
                    }
                }
            }
            if (colonIdx > i) {
                const paramParts = splitTopLevel(tokens.slice(i + 1, colonIdx), ',');
                for (const part of paramParts) {
                    let pIdx = 0;
                    while (pIdx < part.length && part[pIdx].type === 'OP' && (part[pIdx].value === '*' || part[pIdx].value === '**')) {
                        pIdx++;
                    }
                    if (pIdx < part.length && part[pIdx].type === 'NAME' && !HARD_KEYWORDS.has(part[pIdx].value)) {
                        boundNames.add(part[pIdx].value);
                    }
                }
            }
        } else if (t.type === 'NAME' && i + 1 < tokens.length && tokens[i + 1].type === 'OP' && tokens[i + 1].value === ':=') {
            boundNames.add(t.value);
        }
    }

    // Walk tokens to collect variable lookups
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];

        // Skip lambda parameter declarations (only scan default values)
        if (t.type === 'NAME' && t.value === 'lambda') {
            let colonIdx = -1;
            let depth = 0;
            for (let k = i + 1; k < tokens.length; k++) {
                if (tokens[k].type === 'OP') {
                    if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                    else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                    else if (tokens[k].value === ':' && depth === 0) {
                        colonIdx = k;
                        break;
                    }
                }
            }
            if (colonIdx > i) {
                const paramParts = splitTopLevel(tokens.slice(i + 1, colonIdx), ',');
                for (const part of paramParts) {
                    const eqIdx = part.findIndex((pt) => pt.type === 'OP' && pt.value === '=');
                    if (eqIdx >= 0) {
                        extractExpressionLoads(part.slice(eqIdx + 1), boundNames, loadTokens);
                    }
                }
                i = colonIdx + 1;
                continue;
            }
        }

        // Skip comprehension target tokens between `for` and `in`
        if (t.type === 'NAME' && t.value === 'for') {
            let inIdx = -1;
            let depth = 0;
            for (let k = i + 1; k < tokens.length; k++) {
                if (tokens[k].type === 'OP') {
                    if (tokens[k].value === '(' || tokens[k].value === '[' || tokens[k].value === '{') depth++;
                    else if (tokens[k].value === ')' || tokens[k].value === ']' || tokens[k].value === '}') depth = Math.max(0, depth - 1);
                } else if (tokens[k].type === 'NAME' && tokens[k].value === 'in' && depth === 0) {
                    inIdx = k;
                    break;
                }
            }
            if (inIdx > i) {
                i = inIdx + 1;
                continue;
            }
        }

        if (t.type === 'NAME') {
            if (HARD_KEYWORDS.has(t.value) || ['match', 'case', 'type', '_'].includes(t.value)) {
                i++;
                continue;
            }
            // Skip attribute access `.attr`
            if (i > 0 && tokens[i - 1].type === 'OP' && tokens[i - 1].value === '.') {
                i++;
                continue;
            }
            // Skip keyword argument name `func(kw=val)` or `func(a, kw=val)`
            if (
                i > 0 &&
                tokens[i - 1].type === 'OP' &&
                (tokens[i - 1].value === '(' || tokens[i - 1].value === ',') &&
                i + 1 < tokens.length &&
                tokens[i + 1].type === 'OP' &&
                tokens[i + 1].value === '='
            ) {
                i += 2;
                continue;
            }
            // Skip walrus target `name :=`
            if (i + 1 < tokens.length && tokens[i + 1].type === 'OP' && tokens[i + 1].value === ':=') {
                i += 2;
                continue;
            }
            loadTokens.push(t);
        }
        i++;
    }
}

function validateSimpleStatement(
    stmtTokens: PyToken[],
    inFunction: boolean,
    inLoop: boolean,
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    boundNames: Set<string>,
    loadTokens: PyToken[],
    setStarImport: () => void,
    pushDiag: (d: Diagnostic) => void,
): void {
    if (stmtTokens.length === 0) return;
    const first = stmtTokens[0];

    // Decorator `@expr`
    if (first.type === 'OP' && first.value === '@') {
        const rest = stmtTokens.slice(1);
        if (rest.length === 0) {
            pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        validateExpressionTokens(rest, false, false, lineAnchors, originalLines, pushDiag);
        extractExpressionLoads(rest, boundNames, loadTokens);
        return;
    }

    if (first.type === 'NAME') {
        const kw = first.value;

        if (kw === 'pass') {
            if (stmtTokens.length > 1) {
                const nxt = stmtTokens[1];
                pushDiag(makeDiag(lineAnchors, originalLines, nxt.line, nxt.col, nxt.endCol, 'SyntaxError: invalid syntax'));
            }
            return;
        }

        if (kw === 'break' || kw === 'continue') {
            if (!inLoop) {
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        first.line,
                        first.col,
                        first.endCol,
                        `SyntaxError: '${kw}' outside loop`,
                    ),
                );
                return;
            }
            if (stmtTokens.length > 1) {
                const nxt = stmtTokens[1];
                pushDiag(makeDiag(lineAnchors, originalLines, nxt.line, nxt.col, nxt.endCol, 'SyntaxError: invalid syntax'));
            }
            return;
        }

        if (kw === 'return' || kw === 'yield') {
            if (!inFunction) {
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        first.line,
                        first.col,
                        first.endCol,
                        `SyntaxError: '${kw}' outside function`,
                    ),
                );
                return;
            }
            let rest = stmtTokens.slice(1);
            if (kw === 'yield' && rest.length > 0 && rest[0].type === 'NAME' && rest[0].value === 'from') {
                rest = rest.slice(1);
                if (rest.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, stmtTokens[stmtTokens.length - 1].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
            }
            if (rest.length > 0) {
                validateExpressionTokens(rest, false, false, lineAnchors, originalLines, pushDiag);
                extractExpressionLoads(rest, boundNames, loadTokens);
            }
            return;
        }

        if (kw === 'import') {
            const rest = stmtTokens.slice(1);
            if (rest.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            const items = splitTopLevel(rest, ',');
            for (const item of items) {
                if (item.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, stmtTokens[stmtTokens.length - 1].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                const asIdx = item.findIndex((t) => t.type === 'NAME' && t.value === 'as');
                const modPart = asIdx >= 0 ? item.slice(0, asIdx) : item;
                if (modPart.length === 0 || modPart[0].type !== 'NAME') {
                    pushDiag(makeDiag(lineAnchors, originalLines, item[0].line, item[0].col, item[0].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                for (let k = 0; k < modPart.length; k++) {
                    if (k % 2 === 0) {
                        if (modPart[k].type !== 'NAME' || HARD_KEYWORDS.has(modPart[k].value)) {
                            pushDiag(makeDiag(lineAnchors, originalLines, modPart[k].line, modPart[k].col, modPart[k].endCol, 'SyntaxError: invalid syntax'));
                            return;
                        }
                    } else if (modPart[k].type !== 'OP' || modPart[k].value !== '.') {
                        pushDiag(makeDiag(lineAnchors, originalLines, modPart[k].line, modPart[k].col, modPart[k].endCol, 'SyntaxError: invalid syntax'));
                        return;
                    }
                }
                if (modPart.length % 2 === 0) {
                    const last = modPart[modPart.length - 1];
                    pushDiag(makeDiag(lineAnchors, originalLines, last.line, last.col, last.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                if (asIdx >= 0) {
                    const aliasPart = item.slice(asIdx + 1);
                    if (aliasPart.length !== 1 || aliasPart[0].type !== 'NAME' || HARD_KEYWORDS.has(aliasPart[0].value)) {
                        const errTok = aliasPart[0] ?? item[asIdx];
                        pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                        return;
                    }
                    boundNames.add(aliasPart[0].value);
                } else {
                    boundNames.add(modPart[0].value);
                }
            }
            return;
        }

        if (kw === 'from') {
            const importIdx = stmtTokens.findIndex((t, idx) => idx > 0 && t.type === 'NAME' && t.value === 'import');
            if (importIdx < 0) {
                const last = stmtTokens[stmtTokens.length - 1];
                pushDiag(makeDiag(lineAnchors, originalLines, last.line, last.col, last.endCol, "SyntaxError: expected 'import'"));
                return;
            }
            const modPart = stmtTokens.slice(1, importIdx);
            if (modPart.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, stmtTokens[importIdx].endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            let namesPart = stmtTokens.slice(importIdx + 1);
            if (namesPart.length === 0) {
                const impTok = stmtTokens[importIdx];
                pushDiag(makeDiag(lineAnchors, originalLines, impTok.line, impTok.col, impTok.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            if (namesPart.length === 1 && namesPart[0].type === 'OP' && namesPart[0].value === '*') {
                setStarImport();
                return;
            }
            if (
                namesPart[0].type === 'OP' &&
                namesPart[0].value === '(' &&
                findMatchingCloser(namesPart, 0) === namesPart.length - 1
            ) {
                namesPart = namesPart.slice(1, -1);
            }
            const items = splitTopLevel(namesPart, ',');
            for (let idx = 0; idx < items.length; idx++) {
                const item = items[idx];
                if (item.length === 0) {
                    if (idx === items.length - 1 && items.length > 1) continue; // allow trailing comma
                    const impTok = stmtTokens[importIdx];
                    pushDiag(makeDiag(lineAnchors, originalLines, impTok.line, impTok.col, impTok.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                if (item[0].type !== 'NAME' || HARD_KEYWORDS.has(item[0].value)) {
                    pushDiag(makeDiag(lineAnchors, originalLines, item[0].line, item[0].col, item[0].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                if (item.length === 1) {
                    boundNames.add(item[0].value);
                } else if (
                    item.length === 3 &&
                    item[1].type === 'NAME' &&
                    item[1].value === 'as' &&
                    item[2].type === 'NAME' &&
                    !HARD_KEYWORDS.has(item[2].value)
                ) {
                    boundNames.add(item[2].value);
                } else {
                    const errTok = item[1];
                    pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
            }
            return;
        }

        if (kw === 'global' || kw === 'nonlocal') {
            const rest = stmtTokens.slice(1);
            if (rest.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            const parts = splitTopLevel(rest, ',');
            for (const p of parts) {
                if (p.length !== 1 || p[0].type !== 'NAME' || HARD_KEYWORDS.has(p[0].value)) {
                    const errTok = p[0] ?? first;
                    pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                boundNames.add(p[0].value);
            }
            return;
        }

        if (kw === 'del') {
            const rest = stmtTokens.slice(1);
            if (rest.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            if ( validateAssignmentTarget(rest, lineAnchors, originalLines, pushDiag)) {
                extractExpressionLoads(rest, boundNames, loadTokens);
            }
            return;
        }

        if (kw === 'assert') {
            const rest = stmtTokens.slice(1);
            if (rest.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            validateExpressionTokens(rest, false, false, lineAnchors, originalLines, pushDiag);
            extractExpressionLoads(rest, boundNames, loadTokens);
            return;
        }

        if (kw === 'raise') {
            const rest = stmtTokens.slice(1);
            if (rest.length === 0) return;
            let fromIdx = -1;
            let depth = 0;
            for (let k = 0; k < rest.length; k++) {
                if (rest[k].type === 'OP') {
                    if (rest[k].value === '(' || rest[k].value === '[' || rest[k].value === '{') depth++;
                    else if (rest[k].value === ')' || rest[k].value === ']' || rest[k].value === '}') depth = Math.max(0, depth - 1);
                } else if (rest[k].type === 'NAME' && rest[k].value === 'from' && depth === 0) {
                    fromIdx = k;
                    break;
                }
            }
            if (fromIdx >= 0) {
                const excPart = rest.slice(0, fromIdx);
                const causePart = rest.slice(fromIdx + 1);
                if (excPart.length === 0 || causePart.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, rest[fromIdx].line, rest[fromIdx].col, rest[fromIdx].endCol, 'SyntaxError: invalid syntax'));
                    return;
                }
                validateExpressionTokens(excPart, false, false, lineAnchors, originalLines, pushDiag);
                validateExpressionTokens(causePart, false, false, lineAnchors, originalLines, pushDiag);
                extractExpressionLoads(excPart, boundNames, loadTokens);
                extractExpressionLoads(causePart, boundNames, loadTokens);
            } else {
                validateExpressionTokens(rest, false, false, lineAnchors, originalLines, pushDiag);
                extractExpressionLoads(rest, boundNames, loadTokens);
            }
            return;
        }
    }

    // Check top-level augmented assignment (`+=`, `-=`, etc.), type annotation (`x: T = val`), or assignment (`x = val`)
    let depth = 0;
    let augIdx = -1;
    let colonIdx = -1;
    const eqIndices: number[] = [];

    for (let i = 0; i < stmtTokens.length; i++) {
        const t = stmtTokens[i];
        if (t.type === 'OP') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') depth = Math.max(0, depth - 1);
            else if (depth === 0) {
                if (AUG_ASSIGN_OPS.has(t.value) && augIdx < 0) {
                    augIdx = i;
                } else if (t.value === ':' && colonIdx < 0 && eqIndices.length === 0) {
                    colonIdx = i;
                } else if (t.value === '=') {
                    eqIndices.push(i);
                }
            }
        }
    }

    if (augIdx >= 0) {
        const lhs = stmtTokens.slice(0, augIdx);
        const rhs = stmtTokens.slice(augIdx + 1);
        const augTok = stmtTokens[augIdx];
        if (lhs.length === 0 || rhs.length === 0) {
            pushDiag(makeDiag(lineAnchors, originalLines, augTok.line, augTok.col, augTok.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        validateAssignmentTarget(lhs, lineAnchors, originalLines, pushDiag);
        validateExpressionTokens(rhs, false, false, lineAnchors, originalLines, pushDiag);
        extractExpressionLoads(lhs, boundNames, loadTokens);
        extractExpressionLoads(rhs, boundNames, loadTokens);
        return;
    }

    if (colonIdx >= 0) {
        const lhs = stmtTokens.slice(0, colonIdx);
        const colonTok = stmtTokens[colonIdx];
        if (lhs.length === 0 || !validateAssignmentTarget(lhs, lineAnchors, originalLines, pushDiag)) {
            if (lhs.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
            }
            return;
        }
        if (eqIndices.length > 0) {
            const firstEq = eqIndices[0];
            const annotTokens = stmtTokens.slice(colonIdx + 1, firstEq);
            const rhsTokens = stmtTokens.slice(firstEq + 1);
            if (annotTokens.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            if (rhsTokens.length === 0) {
                const eqTok = stmtTokens[firstEq];
                pushDiag(makeDiag(lineAnchors, originalLines, eqTok.line, eqTok.col, eqTok.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            validateExpressionTokens(annotTokens, false, false, lineAnchors, originalLines, pushDiag);
            validateExpressionTokens(rhsTokens, false, false, lineAnchors, originalLines, pushDiag);
            extractExpressionLoads(annotTokens, boundNames, loadTokens);
            extractExpressionLoads(rhsTokens, boundNames, loadTokens);
            extractTargetBindingsAndLoads(lhs, boundNames, loadTokens);
        } else {
            const annotTokens = stmtTokens.slice(colonIdx + 1);
            if (annotTokens.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: expected type annotation'));
                return;
            }
            validateExpressionTokens(annotTokens, false, false, lineAnchors, originalLines, pushDiag);
            extractExpressionLoads(annotTokens, boundNames, loadTokens);
            extractTargetBindingsAndLoads(lhs, boundNames, loadTokens);
        }
        return;
    }

    if (eqIndices.length > 0) {
        const lastEq = eqIndices[eqIndices.length - 1];
        const rhs = stmtTokens.slice(lastEq + 1);
        if (rhs.length === 0) {
            const eqTok = stmtTokens[lastEq];
            pushDiag(makeDiag(lineAnchors, originalLines, eqTok.line, eqTok.col, eqTok.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        // Validate RHS first (evaluated before assignment targets in Python)
        validateExpressionTokens(rhs, false, false, lineAnchors, originalLines, pushDiag);
        extractExpressionLoads(rhs, boundNames, loadTokens);

        let prevIdx = 0;
        for (const eqIdx of eqIndices) {
            const lhs = stmtTokens.slice(prevIdx, eqIdx);
            const eqTok = stmtTokens[eqIdx];
            if (lhs.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, eqTok.line, eqTok.col, eqTok.endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            if (validateAssignmentTarget(lhs, lineAnchors, originalLines, pushDiag)) {
                extractTargetBindingsAndLoads(lhs, boundNames, loadTokens);
            }
            prevIdx = eqIdx + 1;
        }
        return;
    }

    // Plain expression statement
    validateExpressionTokens(stmtTokens, false, false, lineAnchors, originalLines, pushDiag);
    extractExpressionLoads(stmtTokens, boundNames, loadTokens);
}

const COMPOUND_STARTERS = new Set<string>([
    'if',
    'elif',
    'else',
    'for',
    'while',
    'def',
    'class',
    'with',
    'try',
    'except',
    'finally',
    'match',
    'case',
    'async',
]);

function validateDefParams(
    paramTokens: PyToken[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    boundNames: Set<string>,
    loadTokens: PyToken[],
    pushDiag: (d: Diagnostic) => void,
): void {
    if (paramTokens.length === 0) return;
    const parts = splitTopLevel(paramTokens, ',');
    for (let idx = 0; idx < parts.length; idx++) {
        const part = parts[idx];
        if (part.length === 0) {
            if (idx === parts.length - 1 && parts.length > 1) continue; // trailing comma
            const tok = paramTokens[0];
            pushDiag(makeDiag(lineAnchors, originalLines, tok.line, tok.col, tok.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        // `/` or `*`
        if (part.length === 1 && part[0].type === 'OP' && (part[0].value === '/' || part[0].value === '*')) {
            continue;
        }
        let p = part;
        if (p[0].type === 'OP' && (p[0].value === '*' || p[0].value === '**')) {
            p = p.slice(1);
        }
        if (p.length === 0 || p[0].type !== 'NAME' || HARD_KEYWORDS.has(p[0].value)) {
            const errTok = p[0] ?? part[0];
            pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        boundNames.add(p[0].value);
        const rest = p.slice(1);
        if (rest.length === 0) continue;

        let colonIdx = -1;
        let eqIdx = -1;
        let depth = 0;
        for (let k = 0; k < rest.length; k++) {
            if (rest[k].type === 'OP') {
                if (rest[k].value === '(' || rest[k].value === '[' || rest[k].value === '{') depth++;
                else if (rest[k].value === ')' || rest[k].value === ']' || rest[k].value === '}') depth = Math.max(0, depth - 1);
                else if (depth === 0) {
                    if (rest[k].value === ':' && colonIdx < 0 && eqIdx < 0) colonIdx = k;
                    else if (rest[k].value === '=' && eqIdx < 0) eqIdx = k;
                }
            }
        }

        if (colonIdx !== 0 && eqIdx !== 0) {
            pushDiag(makeDiag(lineAnchors, originalLines, rest[0].line, rest[0].col, rest[0].endCol, 'SyntaxError: invalid syntax'));
            return;
        }
        if (colonIdx === 0) {
            const annotEnd = eqIdx >= 0 ? eqIdx : rest.length;
            const annotTokens = rest.slice(1, annotEnd);
            if (annotTokens.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, rest[0].line, rest[0].col, rest[0].endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            validateExpressionTokens(annotTokens, false, false, lineAnchors, originalLines, pushDiag);
            extractExpressionLoads(annotTokens, boundNames, loadTokens);
        }
        if (eqIdx >= 0) {
            const defTokens = rest.slice(eqIdx + 1);
            if (defTokens.length === 0) {
                pushDiag(makeDiag(lineAnchors, originalLines, rest[eqIdx].line, rest[eqIdx].col, rest[eqIdx].endCol, 'SyntaxError: invalid syntax'));
                return;
            }
            validateExpressionTokens(defTokens, false, false, lineAnchors, originalLines, pushDiag);
            extractExpressionLoads(defTokens, boundNames, loadTokens);
        }
    }
}

function validateBlockLogicalLines(
    logicalLines: LogicalLine[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    originalLines: string[],
    boundNames: Set<string>,
    loadTokens: PyToken[],
    setStarImport: () => void,
    pushDiag: (d: Diagnostic) => void,
): void {
    const indentStack: number[] = [0];
    const blockStack: { indent: number; kind: string; line: number }[] = [];
    const lastHeaderAtIndent = new Map<number, string>();
    let expectIndentAfter: { line: number; col: number } | null = null;

    const isInsideFunction = (): boolean => blockStack.some((b) => b.kind === 'def');
    const isInsideLoop = (): boolean => {
        for (let idx = blockStack.length - 1; idx >= 0; idx--) {
            const k = blockStack[idx].kind;
            if (k === 'for' || k === 'while') return true;
            if (k === 'def' || k === 'class') return false;
        }
        return false;
    };

    for (const ll of logicalLines) {
        const { indent, startLine, tokens } = ll;
        if (tokens.length === 0) continue;

        // 1. Check indentation transitions
        if (expectIndentAfter !== null) {
            if (indent <= indentStack[indentStack.length - 1]) {
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        startLine,
                        0,
                        Math.max(1, indent),
                        'SyntaxError: expected an indented block',
                    ),
                );
                expectIndentAfter = null;
            } else {
                indentStack.push(indent);
                expectIndentAfter = null;
            }
        } else {
            const curTop = indentStack[indentStack.length - 1];
            if (indent > curTop) {
                pushDiag(
                    makeDiag(
                        lineAnchors,
                        originalLines,
                        startLine,
                        0,
                        indent,
                        'IndentationError: unexpected indent',
                    ),
                );
                indentStack.push(indent);
            } else if (indent < curTop) {
                while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
                    const poppedIndent = indentStack.pop()!;
                    lastHeaderAtIndent.delete(poppedIndent);
                }
                while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= indent) {
                    blockStack.pop();
                }
                if (indentStack[indentStack.length - 1] !== indent) {
                    pushDiag(
                        makeDiag(
                            lineAnchors,
                            originalLines,
                            startLine,
                            0,
                            Math.max(1, indent),
                            'IndentationError: unindent does not match any outer indentation level',
                        ),
                    );
                }
            } else {
                while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= indent) {
                    blockStack.pop();
                }
            }
        }

        const first = tokens[0];
        const isCompound = first.type === 'NAME' && COMPOUND_STARTERS.has(first.value);

        if (isCompound) {
            let kw = first.value;
            let headerStartIdx = 1;
            if (kw === 'async') {
                if (tokens.length < 2 || tokens[1].type !== 'NAME' || !['def', 'for', 'with'].includes(tokens[1].value)) {
                    const errTok = tokens[1] ?? first;
                    pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                    continue;
                }
                kw = tokens[1].value;
                headerStartIdx = 2;
            }

            // Check block continuation ordering (elif, else, except, finally)
            const prevHeader = lastHeaderAtIndent.get(indent);
            if (kw === 'elif') {
                if (prevHeader !== 'if' && prevHeader !== 'elif') {
                    pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, "SyntaxError: 'elif' without matching 'if'"));
                }
            } else if (kw === 'else') {
                if (!prevHeader || !['if', 'elif', 'for', 'while', 'except'].includes(prevHeader)) {
                    pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, "SyntaxError: 'else' without matching block"));
                }
            } else if (kw === 'except' || kw === 'finally') {
                if (prevHeader !== 'try' && prevHeader !== 'except') {
                    pushDiag(makeDiag(lineAnchors, originalLines, first.line, first.col, first.endCol, `SyntaxError: '${kw}' without matching 'try'`));
                }
            }

            const colonIdx = findTopLevelHeaderColon(tokens);
            if (colonIdx < 0) {
                const last = tokens[tokens.length - 1];
                pushDiag(makeDiag(lineAnchors, originalLines, last.line, last.col, last.endCol, "SyntaxError: expected ':'"));
                continue;
            }

            const headerInner = tokens.slice(headerStartIdx, colonIdx);
            const colonTok = tokens[colonIdx];

            if (kw === 'else' || kw === 'try' || kw === 'finally') {
                if (headerInner.length > 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, headerInner[0].line, headerInner[0].col, headerInner[0].endCol, "SyntaxError: expected ':'"));
                }
            } else if (kw === 'if' || kw === 'elif' || kw === 'while' || kw === 'match' || kw === 'case') {
                if (headerInner.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
                } else if (kw === 'case') {
                    // Bind pattern variables if any
                    for (const pt of headerInner) {
                        if (pt.type === 'NAME' && !HARD_KEYWORDS.has(pt.value) && pt.value !== '_') {
                            boundNames.add(pt.value);
                        }
                    }
                } else {
                    validateExpressionTokens(headerInner, false, false, lineAnchors, originalLines, pushDiag);
                    extractExpressionLoads(headerInner, boundNames, loadTokens);
                }
            } else if (kw === 'for') {
                let inIdx = -1;
                let depth = 0;
                for (let k = 0; k < headerInner.length; k++) {
                    if (headerInner[k].type === 'OP') {
                        if (headerInner[k].value === '(' || headerInner[k].value === '[' || headerInner[k].value === '{') depth++;
                        else if (headerInner[k].value === ')' || headerInner[k].value === ']' || headerInner[k].value === '}') depth = Math.max(0, depth - 1);
                    } else if (headerInner[k].type === 'NAME' && headerInner[k].value === 'in' && depth === 0) {
                        inIdx = k;
                        break;
                    }
                }
                if (inIdx <= 0 || inIdx >= headerInner.length - 1) {
                    pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, first.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
                } else {
                    const targetPart = headerInner.slice(0, inIdx);
                    const iterPart = headerInner.slice(inIdx + 1);
                    validateExpressionTokens(iterPart, false, false, lineAnchors, originalLines, pushDiag);
                    extractExpressionLoads(iterPart, boundNames, loadTokens);
                    if (validateAssignmentTarget(targetPart, lineAnchors, originalLines, pushDiag)) {
                        extractTargetBindingsAndLoads(targetPart, boundNames, loadTokens);
                    }
                }
            } else if (kw === 'with') {
                if (headerInner.length === 0) {
                    pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
                } else {
                    const items = splitTopLevel(headerInner, ',');
                    for (const item of items) {
                        if (item.length === 0) {
                            pushDiag(makeDiag(lineAnchors, originalLines, colonTok.line, colonTok.col, colonTok.endCol, 'SyntaxError: invalid syntax'));
                            break;
                        }
                        let asIdx = -1;
                        let depth = 0;
                        for (let k = 0; k < item.length; k++) {
                            if (item[k].type === 'OP') {
                                if (item[k].value === '(' || item[k].value === '[' || item[k].value === '{') depth++;
                                else if (item[k].value === ')' || item[k].value === ']' || item[k].value === '}') depth = Math.max(0, depth - 1);
                            } else if (item[k].type === 'NAME' && item[k].value === 'as' && depth === 0) {
                                asIdx = k;
                                break;
                            }
                        }
                        if (asIdx >= 0) {
                            const exprPart = item.slice(0, asIdx);
                            const targetPart = item.slice(asIdx + 1);
                            if (exprPart.length === 0 || targetPart.length === 0) {
                                pushDiag(makeDiag(lineAnchors, originalLines, item[asIdx].line, item[asIdx].col, item[asIdx].endCol, 'SyntaxError: invalid syntax'));
                            } else {
                                validateExpressionTokens(exprPart, false, false, lineAnchors, originalLines, pushDiag);
                                extractExpressionLoads(exprPart, boundNames, loadTokens);
                                if (validateAssignmentTarget(targetPart, lineAnchors, originalLines, pushDiag)) {
                                    extractTargetBindingsAndLoads(targetPart, boundNames, loadTokens);
                                }
                            }
                        } else {
                            validateExpressionTokens(item, false, false, lineAnchors, originalLines, pushDiag);
                            extractExpressionLoads(item, boundNames, loadTokens);
                        }
                    }
                }
            } else if (kw === 'except') {
                let excInner = headerInner;
                if (excInner.length > 0 && excInner[0].type === 'OP' && excInner[0].value === '*') {
                    excInner = excInner.slice(1);
                }
                if (excInner.length > 0) {
                    let asIdx = -1;
                    let depth = 0;
                    for (let k = 0; k < excInner.length; k++) {
                        if (excInner[k].type === 'OP') {
                            if (excInner[k].value === '(' || excInner[k].value === '[' || excInner[k].value === '{') depth++;
                            else if (excInner[k].value === ')' || excInner[k].value === ']' || excInner[k].value === '}') depth = Math.max(0, depth - 1);
                        } else if (excInner[k].type === 'NAME' && excInner[k].value === 'as' && depth === 0) {
                            asIdx = k;
                            break;
                        }
                    }
                    if (asIdx >= 0) {
                        const exprPart = excInner.slice(0, asIdx);
                        const aliasPart = excInner.slice(asIdx + 1);
                        if (exprPart.length === 0 || aliasPart.length !== 1 || aliasPart[0].type !== 'NAME' || HARD_KEYWORDS.has(aliasPart[0].value)) {
                            const errTok = aliasPart[0] ?? excInner[asIdx];
                            pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                        } else {
                            validateExpressionTokens(exprPart, false, false, lineAnchors, originalLines, pushDiag);
                            extractExpressionLoads(exprPart, boundNames, loadTokens);
                            boundNames.add(aliasPart[0].value);
                        }
                    } else {
                        validateExpressionTokens(excInner, false, false, lineAnchors, originalLines, pushDiag);
                        extractExpressionLoads(excInner, boundNames, loadTokens);
                    }
                }
            } else if (kw === 'def') {
                if (
                    headerInner.length < 3 ||
                    headerInner[0].type !== 'NAME' ||
                    HARD_KEYWORDS.has(headerInner[0].value) ||
                    headerInner[1].type !== 'OP' ||
                    headerInner[1].value !== '('
                ) {
                    const errTok = headerInner[0] ?? colonTok;
                    pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                } else {
                    boundNames.add(headerInner[0].value);
                    const closeParenIdx = findMatchingCloser(headerInner, 1);
                    const paramTokens = headerInner.slice(2, closeParenIdx);
                    validateDefParams(paramTokens, lineAnchors, originalLines, boundNames, loadTokens, pushDiag);
                    const afterParen = headerInner.slice(closeParenIdx + 1);
                    if (afterParen.length > 0) {
                        if (afterParen[0].type !== 'OP' || afterParen[0].value !== '->' || afterParen.length < 2) {
                            pushDiag(makeDiag(lineAnchors, originalLines, afterParen[0].line, afterParen[0].col, afterParen[0].endCol, 'SyntaxError: invalid syntax'));
                        } else {
                            const retTokens = afterParen.slice(1);
                            validateExpressionTokens(retTokens, false, false, lineAnchors, originalLines, pushDiag);
                            extractExpressionLoads(retTokens, boundNames, loadTokens);
                        }
                    }
                }
            } else if (kw === 'class') {
                if (headerInner.length === 0 || headerInner[0].type !== 'NAME' || HARD_KEYWORDS.has(headerInner[0].value)) {
                    const errTok = headerInner[0] ?? colonTok;
                    pushDiag(makeDiag(lineAnchors, originalLines, errTok.line, errTok.col, errTok.endCol, 'SyntaxError: invalid syntax'));
                } else {
                    boundNames.add(headerInner[0].value);
                    const rest = headerInner.slice(1);
                    if (rest.length > 0) {
                        if (rest[0].type !== 'OP' || rest[0].value !== '(' || findMatchingCloser(rest, 0) !== rest.length - 1) {
                            pushDiag(makeDiag(lineAnchors, originalLines, rest[0].line, rest[0].col, rest[0].endCol, 'SyntaxError: invalid syntax'));
                        } else {
                            const baseTokens = rest.slice(1, -1);
                            if (baseTokens.length > 0) {
                                validateExpressionTokens(baseTokens, false, false, lineAnchors, originalLines, pushDiag, true);
                                extractExpressionLoads(baseTokens, boundNames, loadTokens);
                            }
                        }
                    }
                }
            }

            lastHeaderAtIndent.set(indent, kw);

            const afterColon = tokens.slice(colonIdx + 1);
            if (afterColon.length === 0) {
                expectIndentAfter = { line: colonTok.line, col: colonTok.col };
                blockStack.push({ indent, kind: kw, line: startLine });
            } else {
                // Inline suite after `:` on same line (e.g. `if x: return 1`)
                blockStack.push({ indent, kind: kw, line: startLine });
                const inlineStmts = splitTopLevel(afterColon, ';');
                for (const st of inlineStmts) {
                    if (st.length > 0) {
                        validateSimpleStatement(
                            st,
                            isInsideFunction(),
                            isInsideLoop(),
                            lineAnchors,
                            originalLines,
                            boundNames,
                            loadTokens,
                            setStarImport,
                            pushDiag,
                        );
                    }
                }
                blockStack.pop();
            }
            continue;
        }

        // Simple statement(s) at `indent`
        lastHeaderAtIndent.delete(indent);
        const simpleStmts = splitTopLevel(tokens, ';');
        for (const st of simpleStmts) {
            if (st.length > 0) {
                validateSimpleStatement(
                    st,
                    isInsideFunction(),
                    isInsideLoop(),
                    lineAnchors,
                    originalLines,
                    boundNames,
                    loadTokens,
                    setStarImport,
                    pushDiag,
                );
            }
        }
    }

    if (expectIndentAfter !== null) {
        pushDiag(
            makeDiag(
                lineAnchors,
                originalLines,
                expectIndentAfter.line,
                expectIndentAfter.col,
                expectIndentAfter.col + 1,
                'SyntaxError: expected an indented block',
            ),
        );
    }
}

function levenshtein(a: string, b: string): number {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[a.length][b.length];
}

function findDidYouMean(unknownName: string, candidates: Iterable<string>): string | null {
    const lower = unknownName.toLowerCase();
    let bestPrefix: string | null = null;
    for (const c of candidates) {
        if (c.startsWith('__spl2_') || c === '_Any') continue;
        if (unknownName.length >= 2 && c.toLowerCase().startsWith(lower)) {
            if (!bestPrefix || c.length < bestPrefix.length) {
                bestPrefix = c;
            }
        }
    }
    if (bestPrefix) return bestPrefix;

    let bestDist = 99;
    let bestMatch: string | null = null;
    for (const c of candidates) {
        if (c.startsWith('__spl2_') || c === '_Any') continue;
        const d = levenshtein(lower, c.toLowerCase());
        if (d <= 2 && d < bestDist) {
            bestDist = d;
            bestMatch = c;
        }
    }
    return bestMatch;
}

/**
 * Validates Python syntax, indentation, and undefined variable names across the preprocessed document,
 * mapping any diagnostics back to the original `.spl2` or `.md` source ranges.
 */
export function validatePythonCode(
    outLines: string[],
    originalLines: string[],
    lineAnchors: Map<number, ColumnAnchor[]>,
    symbols: Map<string, SymbolDef>,
    diagnostics: Diagnostic[],
    blocks?: MarkdownBlock[],
    builtinTools: readonly string[] = [],
    spl2Keywords: readonly string[] = [],
): void {
    const linesWithDiagnostics = new Set<number>(diagnostics.map((d) => d.range.start.line));
    const pushDiag = (d: Diagnostic) => {
        const line0 = d.range.start.line;
        if (linesWithDiagnostics.has(line0)) return;
        linesWithDiagnostics.add(line0);
        diagnostics.push(d);
    };

    const boundNames = new Set<string>([
        ...BUILTIN_MAP.keys(),
        ...EXTRA_KNOWN_BUILTINS,
        ...builtinTools,
        ...spl2Keywords,
        '__spl2_ask__',
        '__spl2_agent__',
        '__spl2_decide__',
        '__spl2_enforce__',
        '__spl2_forbid__',
        '__spl2_restrict__',
        '__spl2_success__',
        '__spl2_failure__',
        '__spl2_natural__',
        '_Any',
    ]);
    for (const symName of symbols.keys()) {
        boundNames.add(symName);
    }

    const allLoadTokens: PyToken[] = [];
    let hasStarImport = false;
    const setStarImport = () => {
        hasStarImport = true;
    };

    if (blocks) {
        // Markdown workflow: validate each `spl2` fence independently for syntax/indentation,
        // while accumulating bound names and loads across the shared document scope.
        for (const block of blocks) {
            if (block.kind !== 'spl2') continue;
            const startLine0 = block.line - 1;
            const endLine0 = block.endLine - 1;
            if (endLine0 < startLine0) continue;

            const { logicalLines, fstringExprTokens } = tokenizePythonBlock(
                outLines,
                originalLines,
                lineAnchors,
                startLine0,
                endLine0,
                pushDiag,
            );
            validateBlockLogicalLines(
                logicalLines,
                lineAnchors,
                originalLines,
                boundNames,
                allLoadTokens,
                setStarImport,
                pushDiag,
            );
            for (const fTokens of fstringExprTokens) {
                extractExpressionLoads(fTokens, boundNames, allLoadTokens);
            }
        }
    } else if (outLines.length > 0) {
        const { logicalLines, fstringExprTokens } = tokenizePythonBlock(
            outLines,
            originalLines,
            lineAnchors,
            0,
            outLines.length - 1,
            pushDiag,
        );
        validateBlockLogicalLines(
            logicalLines,
            lineAnchors,
            originalLines,
            boundNames,
            allLoadTokens,
            setStarImport,
            pushDiag,
        );
        for (const fTokens of fstringExprTokens) {
            extractExpressionLoads(fTokens, boundNames, allLoadTokens);
        }
    }

    if (hasStarImport) return;

    // Check all variable lookups (`allLoadTokens`) against `boundNames`
    for (const tok of allLoadTokens) {
        if (linesWithDiagnostics.has(tok.line)) continue;
        if (!boundNames.has(tok.value)) {
            const suggestion = findDidYouMean(tok.value, boundNames);
            const hint = suggestion ? ` Did you mean: '${suggestion}'?` : '';
            pushDiag(
                makeDiag(
                    lineAnchors,
                    originalLines,
                    tok.line,
                    tok.col,
                    tok.endCol,
                    `NameError: name '${tok.value}' is not defined.${hint}`,
                    'undefined-name',
                ),
            );
        }
    }
}

/**
 * Collects additional Python symbols (imports, local/indented assignments, loop variables,
 * `with`/`except` bindings, and inferred types) into `symbols`.
 */
export function collectPythonSymbols(
    sourceLines: string[],
    originalLines: string[],
    symbols: Map<string, SymbolDef>,
    blocks?: MarkdownBlock[],
): void {
    // Also capture any `@name` references in Markdown blockquotes so shared blockquote bindings are known
    if (blocks) {
        const bqDirectives = new Set(['ENFORCE', 'FORBID', 'RESTRICT', 'validate', 'success', 'failure']);
        for (const block of blocks) {
            if (block.kind !== 'natural') continue;
            const valMatch = /@validate\[([A-Za-z_]\w*)\]/.exec(block.text);
            const schemaType = valMatch ? valMatch[1] : undefined;
            for (const m of block.text.matchAll(/(?<![\w@])@([A-Za-z_]\w*)/g)) {
                const vName = m[1];
                if (bqDirectives.has(vName)) continue;
                if (!symbols.has(vName)) {
                    let foundLine = block.line - 1;
                    let foundCol = 0;
                    for (let lIdx = block.line - 1; lIdx < block.endLine; lIdx++) {
                        const rawL = originalLines[lIdx] ?? '';
                        const atIdx = rawL.indexOf(`@${vName}`);
                        if (atIdx >= 0) {
                            foundLine = lIdx;
                            foundCol = atIdx + 1;
                            break;
                        }
                    }
                    symbols.set(vName, {
                        name: vName,
                        kind: SymbolKind.Variable,
                        line: foundLine,
                        col: foundCol,
                        endCol: foundCol + vName.length,
                        inferredType: schemaType,
                    });
                }
            }
        }
    }

    for (let i = 0; i < sourceLines.length; i++) {
        const rawLine = sourceLines[i];
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // 1. `import a, b as c`
        const importMatch = /^\s*import\s+(.+)$/.exec(rawLine);
        if (importMatch) {
            for (const part of importMatch[1].split(',')) {
                const p = part.trim();
                const asM = /^([A-Za-z0-9_.]+)\s+as\s+([A-Za-z_]\w*)/.exec(p);
                const modName = asM ? asM[1].split('.')[0] : p.split('.')[0].trim();
                const symName = asM ? asM[2] : modName;
                if (symName && /^[A-Za-z_]\w*$/.test(symName) && !symbols.has(symName)) {
                    const col = Math.max(0, rawLine.indexOf(symName));
                    symbols.set(symName, {
                        name: symName,
                        kind: SymbolKind.Module,
                        line: i,
                        col,
                        endCol: col + symName.length,
                        inferredType: `module:${asM ? asM[1] : p.trim()}`,
                    });
                }
            }
            continue;
        }

        // 2. `from mod import a, b as c`
        const fromMatch = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/.exec(rawLine);
        if (fromMatch) {
            const modPath = fromMatch[1];
            const namesText = fromMatch[2].replace(/[()]/g, '');
            for (const part of namesText.split(',')) {
                const p = part.trim();
                if (!p || p === '*') continue;
                const asM = /^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)/.exec(p);
                const origName = asM ? asM[1] : p;
                const symName = asM ? asM[2] : p;
                if (symName && /^[A-Za-z_]\w*$/.test(symName) && !symbols.has(symName)) {
                    const col = Math.max(0, rawLine.indexOf(symName));
                    const isClassLike = /^[A-Z]/.test(origName);
                    symbols.set(symName, {
                        name: symName,
                        kind: isClassLike ? SymbolKind.Class : SymbolKind.Variable,
                        line: i,
                        col,
                        endCol: col + symName.length,
                        inferredType: origName === 'Path' ? 'type[Path]' : isClassLike ? `type[${origName}]` : `${modPath}.${origName}`,
                    });
                }
            }
            continue;
        }

        // 3. `for x in iter:` / `async for x in iter:`
        const forMatch = /^(\s*)(?:async\s+)?for\s+([A-Za-z_0-9,\s()]+?)\s+in\s+(.+?)\s*:\s*(?:#.*)?$/.exec(rawLine);
        if (forMatch) {
            const targetsRaw = forMatch[2];
            const iterExpr = forMatch[3].trim();
            let elemType: string | undefined;

            // Infer element type from `obj.field` (e.g. `for f in review.findings:`)
            const attrIter = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(iterExpr);
            if (attrIter) {
                const baseSym = symbols.get(attrIter[1]);
                const baseClass = baseSym?.inferredType ? symbols.get(baseSym.inferredType) : undefined;
                const fieldInfo = baseClass?.fields?.find((f) => f.name === attrIter[2]);
                if (fieldInfo) {
                    const listElem = /^(?:list|List|Sequence|Iterable|set|Set)\[\s*([A-Za-z_]\w*)\s*\]$/.exec(fieldInfo.typeAnnotation);
                    if (listElem) elemType = listElem[1];
                }
            }

            const targetNames = targetsRaw
                .replace(/[()]/g, '')
                .split(',')
                .map((s) => s.trim())
                .filter((s) => /^[A-Za-z_]\w*$/.test(s));

            for (const tName of targetNames) {
                if (!symbols.has(tName)) {
                    const col = Math.max(0, rawLine.indexOf(tName, forMatch[1].length));
                    symbols.set(tName, {
                        name: tName,
                        kind: SymbolKind.Variable,
                        line: i,
                        col,
                        endCol: col + tName.length,
                        inferredType: targetNames.length === 1 ? elemType : undefined,
                    });
                }
            }
            continue;
        }

        // 4. Assignments at any indentation level (`x = ...`, `x: T = ...`, `a, b = ...`)
        const assignMatch = /^(\s*)([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)(?:\s*:\s*([^=]+?))?\s*=(?!=)\s*(.*)$/.exec(rawLine);
        if (assignMatch) {
            const lhsRaw = assignMatch[2];
            const typeAnnot = assignMatch[3]?.trim();
            const rhs = assignMatch[4].trim();
            const varNames = lhsRaw.split(',').map((s) => s.trim());

            for (const vName of varNames) {
                if (!/^[A-Za-z_]\w*$/.test(vName)) continue;
                let inferred: string | undefined = typeAnnot;
                if (!inferred && varNames.length === 1) {
                    if (/^\[/.test(rhs)) inferred = 'list';
                    else if (/^\{.*:/.test(rhs) || /^\{\s*\}$/.test(rhs)) inferred = 'dict';
                    else if (/^\{/.test(rhs)) inferred = 'set';
                    else if (/^(?:[fFrRbBuU]{0,2})['"]/.test(rhs)) inferred = 'str';
                    else if (/^[+-]?\d+$/.test(rhs)) inferred = 'int';
                    else if (/^[+-]?\d+\.\d+/.test(rhs)) inferred = 'float';
                    else if (/^(?:True|False)\b/.test(rhs)) inferred = 'bool';
                    else {
                        const callM = /^([A-Za-z_]\w*)\s*\(/.exec(rhs);
                        if (callM) {
                            const callee = callM[1];
                            if (callee === 'Path') inferred = 'Path';
                            else if (symbols.get(callee)?.kind === SymbolKind.Class) inferred = callee;
                            else if (BUILTIN_MAP.get(callee)?.returnType) inferred = BUILTIN_MAP.get(callee)!.returnType;
                        }
                    }
                }
                const existing = symbols.get(vName);
                if (!existing) {
                    const col = Math.max(0, rawLine.indexOf(vName, assignMatch[1].length));
                    symbols.set(vName, {
                        name: vName,
                        kind: SymbolKind.Variable,
                        line: i,
                        col,
                        endCol: col + vName.length,
                        inferredType: inferred,
                    });
                } else if (!existing.inferredType && inferred) {
                    existing.inferredType = inferred;
                }
            }
        }
    }
}

function normalizeBaseType(typeStr: string | undefined): string | null {
    if (!typeStr) return null;
    const t = typeStr.trim();
    if (t === 'str' || t.startsWith('Literal[')) return 'str';
    if (t === 'list' || /^list\[|^List\[|^Sequence\[/.test(t)) return 'list';
    if (t === 'dict' || /^dict\[|^Dict\[|^Mapping\[/.test(t)) return 'dict';
    if (t === 'set' || /^set\[|^Set\[|^frozenset/.test(t)) return 'set';
    if (t === 'tuple' || /^tuple\[|^Tuple\[/.test(t)) return 'tuple';
    if (t === 'Path' || t === 'pathlib.Path') return 'Path';
    return t;
}

/**
 * Resolves the inferred type of an expression chain before a `.` (e.g. `person`, `review.findings`, `'\n'`, `os`).
 */
export function resolveDotTargetCompletions(
    beforeCursor: string,
    analysis: SPL2Analysis,
): CompletionItem[] | null {
    // Check string literal before dot: `'...'.` or `"..." .`
    if (/['"]\.\s*[A-Za-z_0-9]*$/.test(beforeCursor)) {
        return PYTHON_TYPE_METHODS.str.map((m) => ({
            label: m.name,
            kind: m.kind,
            detail: m.detail,
            documentation: { kind: MarkupKind.Markdown, value: m.doc },
        }));
    }

    const chainMatch = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\s*([A-Za-z_]\w*)?$/.exec(beforeCursor);
    if (!chainMatch) return null;

    const parts = chainMatch[1].split('.');
    const rootName = parts[0];

    // Check if rootName is a known Python module (`os.`, `json.`, `asyncio.`, `re.`, `sys.`, etc.)
    const rootSym = analysis.symbols.get(rootName);
    const modKey =
        rootSym?.inferredType?.startsWith('module:')
            ? rootSym.inferredType.slice('module:'.length)
            : PYTHON_MODULES[rootName]
            ? rootName
            : null;
    if (modKey && parts.length === 1 && PYTHON_MODULES[modKey]) {
        return PYTHON_MODULES[modKey].exports.map((e) => ({
            label: e.name,
            kind: e.kind,
            detail: e.detail,
            documentation: { kind: MarkupKind.Markdown, value: e.doc },
        }));
    }

    // Walk attribute chain `a.b.c` using `analysis.symbols` and class field types
    let curType: string | undefined = rootSym?.inferredType;
    if (!curType && rootSym?.kind === SymbolKind.Class) {
        curType = `type[${rootSym.name}]`;
    }
    if (!curType && (rootName === 'str' || rootName === 'list' || rootName === 'dict' || rootName === 'set' || rootName === 'tuple' || rootName === 'Path')) {
        curType = rootName;
    }

    for (let idx = 1; idx < parts.length; idx++) {
        if (!curType) break;
        const cleanType = curType.replace(/^type\[(.+)\]$/, '$1');
        const clsSym = analysis.symbols.get(cleanType);
        const field: ClassFieldInfo | undefined = clsSym?.fields?.find((f) => f.name === parts[idx]);
        if (field) {
            curType = field.typeAnnotation;
        } else {
            curType = undefined;
        }
    }

    if (!curType) return null;

    const cleanClass = curType.replace(/^type\[(.+)\]$/, '$1');
    const classSym = analysis.symbols.get(cleanClass);
    const items: CompletionItem[] = [];

    if (classSym) {
        if (classSym.fields) {
            for (const field of classSym.fields) {
                items.push({
                    label: field.name,
                    kind: CompletionItemKind.Field,
                    detail: `${field.name}: ${field.typeAnnotation} (${classSym.name})`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `Pydantic field on \`${classSym.name}\` (inferred from \`schema=${classSym.name}\`).`,
                    },
                });
            }
        }
        for (const m of PYTHON_TYPE_METHODS.BaseModel) {
            items.push({
                label: m.name,
                kind: m.kind,
                detail: m.detail,
                documentation: { kind: MarkupKind.Markdown, value: m.doc },
            });
        }
        return items;
    }

    const norm = normalizeBaseType(cleanClass);
    if (norm && PYTHON_TYPE_METHODS[norm]) {
        return PYTHON_TYPE_METHODS[norm].map((m) => ({
            label: m.name,
            kind: m.kind,
            detail: m.detail,
            documentation: { kind: MarkupKind.Markdown, value: m.doc },
        }));
    }

    return null;
}

/**
 * Provides context-aware Python import completions (`import <mod>`, `from <mod> import <name>`).
 */
export function getImportCompletions(beforeCursor: string): CompletionItem[] | null {
    const fromImportMatch = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_,\s]*)$/.exec(beforeCursor);
    if (fromImportMatch) {
        const modName = fromImportMatch[1];
        const modInfo = PYTHON_MODULES[modName];
        if (modInfo) {
            return modInfo.exports.map((e) => ({
                label: e.name,
                kind: e.kind,
                detail: e.detail,
                documentation: { kind: MarkupKind.Markdown, value: e.doc },
            }));
        }
        return [];
    }

    const importModMatch = /^\s*(?:import|from)\s+([A-Za-z0-9_.]*)$/.exec(beforeCursor);
    if (importModMatch) {
        return Object.entries(PYTHON_MODULES).map(([modName, info]) => ({
            label: modName,
            kind: CompletionItemKind.Module,
            detail: `Python module ${modName}`,
            documentation: { kind: MarkupKind.Markdown, value: info.doc },
        }));
    }

    return null;
}

/**
 * Appends Python keywords and built-in functions, types, exceptions, and constants to `items`
 * (deduplicating against labels already present).
 */
export function appendPythonTopLevelCompletions(items: CompletionItem[]): void {
    const seen = new Set<string>(items.map((it) => it.label));

    for (const b of PYTHON_BUILTINS) {
        if (seen.has(b.name)) continue;
        seen.add(b.name);
        items.push({
            label: b.name,
            kind: b.kind,
            detail: b.signature,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `\`\`\`python\n${b.signature}\n\`\`\`\n\n${b.doc}`,
            },
        });
    }

    for (const kw of PYTHON_KEYWORDS) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        items.push({
            label: kw,
            kind: CompletionItemKind.Keyword,
            detail: 'Python keyword',
            documentation: PYTHON_KEYWORD_DOCS[kw]
                ? { kind: MarkupKind.Markdown, value: PYTHON_KEYWORD_DOCS[kw] }
                : undefined,
        });
    }
}

/**
 * Provides hover documentation for Python built-in functions/types/exceptions, keywords, and modules.
 */
export function getPythonHoverDoc(word: string, range: Range): Hover | null {
    const builtin = BUILTIN_MAP.get(word);
    if (builtin) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `\`\`\`python\n${builtin.signature}\n\`\`\`\n\n${builtin.doc}`,
            },
            range,
        };
    }

    if (PYTHON_KEYWORD_DOCS[word]) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: PYTHON_KEYWORD_DOCS[word],
            },
            range,
        };
    }

    if (PYTHON_MODULES[word]) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**\`module ${word}\`** — ${PYTHON_MODULES[word].doc}`,
            },
            range,
        };
    }

    return null;
}
